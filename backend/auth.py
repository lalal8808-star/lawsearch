import os
from datetime import datetime, timedelta
from typing import Optional
import jwt
from jwt import PyJWKClient
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import User, get_db

# Secret key to sign JWT (Legacy)
SECRET_KEY = os.getenv("SECRET_KEY", "jonglaw_secret_key_2026_xyz")
# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://cihzxfxtxpgdvebupeua.supabase.co")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

ALGORITHMS = ["HS256", "HS384", "HS512", "RS256", "ES256"]
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

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

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # --- Diagnostic Logging ---
    try:
        header = jwt.get_unverified_header(token)
        print(f"DEBUG: Token alg={header.get('alg')}, header={header}")
    except Exception as e:
        print(f"DEBUG: JWT Pre-check failed: {e}")
    # --------------------------

    payload = None
    header = jwt.get_unverified_header(token)
    alg = header.get("alg")

    # 1. Try Supabase JWT
    if SUPABASE_JWT_SECRET or alg == "ES256":
        try:
            if alg == "ES256":
                # Use JWKS for asymmetric ES256
                signing_key = jwks_client.get_signing_key_from_jwt(token)
                payload = jwt.decode(
                    token, 
                    signing_key.key, 
                    algorithms=["ES256"], 
                    audience="authenticated"
                )
            else:
                # Use Symmetric Secret for HS256
                payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS, audience="authenticated")
        except jwt.InvalidAudienceError:
            try:
                if alg == "ES256":
                    signing_key = jwks_client.get_signing_key_from_jwt(token)
                    payload = jwt.decode(token, signing_key.key, algorithms=["ES256"])
                else:
                    payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS)
            except Exception as e:
                print(f"DEBUG: Supabase JWT decode fallback failed: {e}")
                payload = None
        except Exception as e:
            print(f"DEBUG: Supabase JWT decode failed: {e}")
            payload = None

    # 2. Try Legacy Secret if Supabase failed or wasn't configured
    if payload is None:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=ALGORITHMS)
        except Exception as e:
            print(f"DEBUG: Legacy JWT decode failed: {e}")
            raise credentials_exception
    
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
