import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, get_db
from main import app
import os

# Use a separate test database
TEST_DB_URL = "sqlite:///./test_api_key.db"

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

# Create DB tables
Base.metadata.create_all(bind=engine)

client = TestClient(app)

def test_api_key_flow():
    # 1. Signup
    username = "apikeytestuser"
    password = "testpassword123"
    nickname = "Test User"
    
    # Cleanup previous run if any (not easily possible with sqlite file without delete, but user is unique)
    # We can rely on random username or just handle error
    import uuid
    username = f"user_{uuid.uuid4()}"
    
    response = client.post(
        "/auth/signup",
        data={"username": username, "password": password, "nickname": nickname}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Generate API Key
    key_name = "My Test Key"
    response = client.post(
        "/auth/api-keys",
        data={"name": key_name},
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    api_key = data["api_key"]
    key_prefix = data["prefix"]
    assert api_key.startswith("jl_")
    assert key_prefix == api_key[:10]
    
    print(f"\nGenerated API Key: {api_key}")
    
    # 3. List API Keys
    response = client.get("/auth/api-keys", headers=headers)
    assert response.status_code == 200
    keys = response.json()
    assert len(keys) > 0
    key_id = keys[0]["id"]
    assert keys[0]["name"] == key_name
    
    # 4. Use API Key to access /auth/me (which uses get_current_user)
    # The /auth/me endpoint uses Depends(auth.get_current_user)
    response = client.get(
        "/auth/me",
        headers={"X-API-Key": api_key}
    )
    assert response.status_code == 200
    assert response.json()["username"] == username
    print("Successfully accessed /auth/me with API Key")
    
    # 5. Delete/Revoke API Key
    response = client.delete(f"/auth/api-keys/{key_id}", headers=headers)
    assert response.status_code == 200
    
    # 6. Verify Access Denied
    response = client.get(
        "/auth/me",
        headers={"X-API-Key": api_key}
    )
    # Expect 401 because get_current_user raises HTTPException(401) if no valid creds
    assert response.status_code == 401
    print("Successfully denied access with revoked API Key")

if __name__ == "__main__":
    # Manually run the test function if executed as script
    try:
        test_api_key_flow()
        print("\nAll tests passed successfully!")
    except AssertionError as e:
        print(f"\nTest FAILED: {e}")
    except Exception as e:
        print(f"\nAn error occurred: {e}")
    finally:
        # Cleanup DB file
        if os.path.exists("./test_api_key.db"):
            os.remove("./test_api_key.db")
