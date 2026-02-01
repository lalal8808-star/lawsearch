import os
from datetime import datetime, timedelta
from typing import Optional
import jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import User, get_db

# Secret key to sign JWT (Legacy)
SECRET_KEY = os.getenv("SECRET_KEY", "jonglaw_secret_key_2026_xyz")
# Supabase JWT Secret (New)
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
ALGORITHMS = ["HS256", "HS384", "HS512", "RS256"]
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

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
    
    payload = None
    # Diagnostic: check header
    try:
        header = jwt.get_unverified_header(token)
        print(f"DEBUG: Token header={header}")
    except Exception as he:
        print(f"DEBUG: Could not read token header: {he}")

    # 1. Try Supabase JWT Secret
    if SUPABASE_JWT_SECRET:
        try:
            # Supabase tokens often have 'aud': 'authenticated'
            # We try with audience first
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS, audience="authenticated")
        except jwt.InvalidAudienceError:
            # Fallback: decode without audience check if it's the only issue
            try:
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
    
    # Extract identity
    # Supabase uses 'sub' for UUID
    # Legacy uses 'sub' for username
    sub: str = payload.get("sub")
    if sub is None:
        raise credentials_exception
        
    # Look up user
    # Try by supabase_id first
    user = db.query(User).filter(User.supabase_id == sub).first()
    
    # If not found, try by username (for legacy users)
    if user is None:
        user = db.query(User).filter(User.username == sub).first()
        
    if user is None:
        print(f"DEBUG: get_current_user FAILED. User with sub/username '{sub}' not found in database.")
        raise credentials_exception
        
    # print(f"DEBUG: get_current_user SUCCESS for {user.username}")
    return user

from fastapi import Request

async def get_current_user_optional(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    # print(f"DEBUG: get_current_user_optional token prefix={token[:10]}...")
    
    payload = None
    # 1. Try Supabase JWT
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS, audience="authenticated")
        except Exception:
            try:
                payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=ALGORITHMS)
            except Exception as e:
                # Log why it failed
                # print(f"DEBUG: Optional Supabase JWT decode failed: {e}")
                payload = None
                
    # 2. Try Legacy Secret
    if payload is None:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=ALGORITHMS)
        except Exception as e:
            # print(f"DEBUG: Optional Legacy JWT decode failed: {e}")
            return None
            
    sub: str = payload.get("sub")
    if sub is None:
        return None
        
    user = db.query(User).filter((User.supabase_id == sub) | (User.username == sub)).first()
    if user:
        # print(f"DEBUG: Detected user {user.username} (ID: {user.id})")
        pass
    else:
        # print(f"DEBUG: User identity '{sub}' not found in database")
        pass
    return user
