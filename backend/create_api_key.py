import sys
import os

# Ensure backend directory is in path if run from there
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal, User, APIKey
import auth

def create_key(username, key_name="CLI Generated Key"):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            print(f"❌ User '{username}' not found.")
            print("\nAvailable Users:")
            for u in db.query(User).all():
                print(f"- {u.username}")
            return

        plain_key, hashed_key = auth.generate_api_key()
        
        new_key = APIKey(
            user_id=user.id,
            key_prefix=plain_key[:10], 
            hashed_key=hashed_key,
            name=key_name,
            is_active=1
        )
        db.add(new_key)
        db.commit()
        
        print(f"\n✅ [SUCCESS] API Key Created for '{username}'!")
        print(f"🔑 API Key: {plain_key}")
        print(f"🏷️  Name:    {key_name}")
        print("\n⚠️  SAVE THIS KEY NOW! It cannot be retrieved later.")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python create_api_key.py <username> [key_name]")
        
        # List users to help
        db = SessionLocal()
        users = db.query(User).all()
        if users:
            print("\nExisting Users (copy a username):")
            for u in users:
                print(f"- {u.username}")
        else:
            print("\nNo users found in database.")
        db.close()
    else:
        username = sys.argv[1]
        key_name = sys.argv[2] if len(sys.argv) > 2 else "CLI Generated Key"
        create_key(username, key_name)
