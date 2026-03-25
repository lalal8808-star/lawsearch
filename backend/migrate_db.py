import sqlite3
import os
import sys

# Add current directory to path so we can import database
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import init_db

db_path = "/Users/imjonghwa/lawsearch/backend/law_history.db"

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Check users table for supabase_id
    try:
        cursor.execute("SELECT supabase_id FROM users LIMIT 1")
    except sqlite3.OperationalError:
        print("Adding supabase_id to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN supabase_id TEXT")
        cursor.execute("CREATE UNIQUE INDEX ix_users_supabase_id ON users (supabase_id)")
    
    # 2. Check reports table for chat_history
    try:
        cursor.execute("SELECT chat_history FROM reports LIMIT 1")
    except sqlite3.OperationalError:
        print("Adding chat_history to reports table...")
        cursor.execute("ALTER TABLE reports ADD COLUMN chat_history TEXT")
    
    conn.commit()
    conn.close()

    print("Migration complete.")
    
    # create any new tables (like api_keys)
    print("Creating new tables...")
    init_db()
    print("Table creation complete.")
else:
    print("Database not found at", db_path)
