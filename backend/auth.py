import os
from datetime import datetime, timedelta
from typing import Optional
import jwt
from jwt import PyJWKClient
import jwt
from jwt import PyJWKClient
import bcrypt
import secrets
import hashlib
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from sqlalchemy.orm import Session
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
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

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

def decode_token_payload(token: str) -> dict:
    """Decodes and verifies a JWT token. Returns the payload or raises HTTPException."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
    except Exception:
        raise credentials_exception

    payload = None
    # 1. Try Supabase JWT
    if SUPABASE_JWT_SECRET or alg == "ES256":
        try:
            if alg == "ES256":
                signing_key = jwks_client.get_signing_key_from_jwt(token)
                payload = jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
            else:
                payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS, audience="authenticated")
        except jwt.InvalidAudienceError:
            try:
                if alg == "ES256":
                    signing_key = jwks_client.get_signing_key_from_jwt(token)
                    payload = jwt.decode(token, signing_key.key, algorithms=["ES256"])
                else:
                    payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS)
            except Exception:
                pass
        except Exception:
            pass

    # 2. Try Legacy Secret
    if payload is None:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=ALGORITHMS)
        except Exception:
            raise credentials_exception
            
    return payload

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

    payload = decode_token_payload(token)
    
    sub: str = payload.get("sub")
    print(f"DEBUG: Token sub value is '{sub}'") 
    if sub is None:
        raise credentials_exception
        
    user = db.query(User).filter(User.supabase_id == sub).first()
    if user is None:
        user = db.query(User).filter(User.username == sub).first()
        
    if user is None:
        print(f"DEBUG: get_current_user FAILED. User with sub/username '{sub}' not found in database.")
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
    token = auth_header.split(" ")[1]
    
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        
        payload = None
        # 1. Try Supabase
        if SUPABASE_JWT_SECRET or alg == "ES256":
            try:
                if alg == "ES256":
                    signing_key = jwks_client.get_signing_key_from_jwt(token)
                    payload = jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
                else:
                    payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS, audience="authenticated")
            except Exception:
                try:
                    if alg == "ES256":
                        signing_key = jwks_client.get_signing_key_from_jwt(token)
                        payload = jwt.decode(token, signing_key.key, algorithms=["ES256"])
                    else:
                        payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS)
                except Exception:
                    payload = None
                    
        # 2. Try Legacy
        if payload is None:
            try:
                payload = jwt.decode(token, SECRET_KEY, algorithms=ALGORITHMS)
            except Exception:
                return None
                
        sub: str = payload.get("sub")
        if sub is None:
            return None
            
        return db.query(User).filter((User.supabase_id == sub) | (User.username == sub)).first()
    except Exception:
        return None
