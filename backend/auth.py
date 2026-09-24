import os
import logging
from datetime import datetime, timedelta
from typing import Optional
import jwt
from jwt import PyJWKClient
import bcrypt
import secrets
import hashlib
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from sqlalchemy.orm import Session
from database import User, APIKey, get_db

# Secret key to sign JWT (Legacy)
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("CRITICAL SECURITY ERROR: SECRET_KEY environment variable is missing. Refusing to start over insecure default.")

# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://cihzxfxtxpgdvebupeua.supabase.co")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

ALGORITHMS = ["HS256", "HS384", "HS512", "RS256", "ES256"]
# 대칭키(SUPABASE_JWT_SECRET / SECRET_KEY)로 검증할 때는 HMAC 알고리즘만 허용한다.
# (RS256/ES256을 대칭키로 검증하도록 허용하면 알고리즘 혼동 공격 표면이 생긴다)
HMAC_ALGORITHMS = ["HS256", "HS384", "HS512"]
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

logger = logging.getLogger(__name__)

# 모듈 레벨 공용 401 (get_current_user 등에서 재사용). 이전엔 decode_token_payload 내부
# 지역변수라 get_current_user에서 raise 시 NameError→500이 났다.
credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

API_KEY_PREFIX = "jl_"

# JWKS Client for ES256/RS256 Supabase tokens
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
jwks_client = PyJWKClient(JWKS_URL)

def verify_password(plain_password: str, hashed_password: str):
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'), 
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def get_api_key_hash(api_key: str) -> str:
    """Hashes the API key using SHA-256."""
    return hashlib.sha256(api_key.encode()).hexdigest()

def verify_api_key_hash(plain_api_key: str, hashed_api_key: str) -> bool:
    """Verifies the API key against its hash."""
    return secrets.compare_digest(get_api_key_hash(plain_api_key), hashed_api_key)

def generate_api_key():
    """Generates a new API key and its hash."""
    # Generate 32 bytes of random data, urlsafe encoded
    # resulting string length approx 43 chars
    raw_key = secrets.token_urlsafe(32)
    api_key = f"{API_KEY_PREFIX}{raw_key}"
    hashed_key = get_api_key_hash(api_key)
    return api_key, hashed_key

def get_password_hash(password: str):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")
    return encoded_jwt

async def get_user_by_api_key(api_key: str, db: Session):
    try:
        # 1. Check if key starts with prefix
        if not api_key.startswith(API_KEY_PREFIX):
            return None
            
        # 2. Hash the key
        hashed_key = get_api_key_hash(api_key)
        
        # 3. Find in DB
        db_key = db.query(APIKey).filter(APIKey.hashed_key == hashed_key, APIKey.is_active == 1).first()
        
        if db_key:
            # Update last used
            db_key.last_used_at = datetime.utcnow()
            db.commit()
            return db_key.owner
            
        return None
    except Exception as e:
        print(f"Error validating API key: {e}")
        return None

TOKEN_KIND_SUPABASE = "supabase"
TOKEN_KIND_LEGACY = "legacy"


def _decode_supabase_token(token: str, alg: Optional[str]) -> Optional[dict]:
    if not (SUPABASE_JWT_SECRET or alg == "ES256"):
        return None
    for audience in ("authenticated", None):
        try:
            if alg == "ES256":
                signing_key = jwks_client.get_signing_key_from_jwt(token)
                key, algorithms = signing_key.key, ["ES256"]
            else:
                key, algorithms = SUPABASE_JWT_SECRET, HMAC_ALGORITHMS
            if audience:
                return jwt.decode(token, key, algorithms=algorithms, audience=audience)
            # aud 클레임이 없는 토큰만 통과한다(다른 aud를 가진 토큰은 여기서도 거부됨).
            return jwt.decode(token, key, algorithms=algorithms)
        except jwt.InvalidAudienceError:
            continue
        except Exception:
            return None
    return None


def decode_token(token: str) -> tuple[dict, str]:
    """JWT를 검증하고 (payload, 발급 주체)를 돌려준다.

    Supabase가 발급한 토큰과 이 서버가 발급한 레거시 토큰은 sub의 의미가 다르다
    (Supabase: 사용자 UUID, 레거시: username). 어느 키로 검증됐는지를 함께 반환해
    호출부가 sub를 올바른 컬럼으로만 조회하게 한다. 둘을 섞어 조회하면 레거시 가입으로
    만든 토큰이 다른 사람의 supabase_id와 일치해 그 계정으로 로그인되는 문제가 생긴다."""
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except Exception:
        raise credentials_exception

    payload = _decode_supabase_token(token, alg)
    if payload is not None:
        return payload, TOKEN_KIND_SUPABASE

    try:
        return jwt.decode(token, SECRET_KEY, algorithms=HMAC_ALGORITHMS), TOKEN_KIND_LEGACY
    except Exception:
        raise credentials_exception


def decode_token_payload(token: str) -> dict:
    """Decodes and verifies a JWT token. Returns the payload or raises HTTPException."""
    return decode_token(token)[0]


def find_user_for_token(payload: dict, kind: str, db: Session) -> Optional[User]:
    sub = payload.get("sub")
    if not sub:
        return None
    if kind == TOKEN_KIND_SUPABASE:
        return db.query(User).filter(User.supabase_id == sub).first()
    # 레거시 토큰은 Google(Supabase)로 연결되지 않은 레거시 계정에만 유효하다.
    # 연결된 계정은 이메일 소유가 확인된 Supabase 로그인으로만 접근한다.
    return db.query(User).filter(User.username == sub, User.supabase_id.is_(None)).first()


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme), 
    api_key: Optional[str] = Depends(api_key_header),
    db: Session = Depends(get_db)
):
    # 1. Try API Key first if present
    if api_key:
        user = await get_user_by_api_key(api_key, db)
        if user:
            return user
            
    # 2. If no API key or invalid, require token
    if not token:
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload, kind = decode_token(token)
    user = find_user_for_token(payload, kind, db)
    if user is None:
        logger.debug("get_current_user: no matching user for token subject")
        raise credentials_exception
        
    return user

from fastapi import Request

async def get_current_user_optional(request: Request, db: Session = Depends(get_db)):
    # 1. Try API Key
    api_key = request.headers.get("X-API-Key")
    if api_key:
        user = await get_user_by_api_key(api_key, db)
        if user:
            return user

    # 2. Try Bearer Token
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    try:
        payload, kind = decode_token(auth_header.split(" ")[1])
        return find_user_for_token(payload, kind, db)
    except Exception:
        return None
