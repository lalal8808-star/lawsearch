import asyncio
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from database import Subscription, Notification, User
from api.law_client import law_client
from datetime import datetime

class LegalWatchEngine:
    async def check_updates(self, db: Session) -> List[Dict[str, Any]]:
        """
        Check for law updates for all subscriptions across all users.
        """
        subscriptions = db.query(Subscription).all()
        results = []
        
        for sub in subscriptions:
            try:
                # Search for the law to get the latest metadata
                search_res = await law_client.search_laws(sub.law_name)
                laws = search_res.get("law", [])
                if isinstance(laws, dict): laws = [laws]
                
                best_match = None
                for l in laws:
                    if l.get("법령명한글") == sub.law_name:
                        best_match = l
                        break
                
                if not best_match and laws:
                    # Fallback to the first result if exact name match fails but something was found
                    best_match = laws[0]
                
                if best_match:
                    latest_mst = str(best_match.get("법령일련번호"))
                    latest_date = str(best_match.get("시행일자"))
                    amendment_type = best_match.get("제개정구분명")
                    
                    # Log for debugging
                    # print(f"Checking {sub.law_name}: stored={sub.last_enforced_date}, latest={latest_date}")
                    
                    if latest_date != sub.last_enforced_date:
                        # Found an update or a different enforcement version
                        notification = Notification(
                            user_id=sub.user_id,
                            type="LAW_UPDATE",
                            title=f"🔔 법령 개정 알림: {sub.law_name}",
                            message=f"사용자님께서 구독하신 '{sub.law_name}' 법령이 {latest_date}부로 개정({amendment_type})되었습니다. 이전 상담 내용과 관련된 변경 사항이 있는지 확인해보세요.",
                            link=f"/laws/detail/{latest_mst}" # Potential link format
                        )
                        db.add(notification)
                        
                        # Update subscription to the latest version to avoid duplicate notifications
                        sub.last_enforced_date = latest_date
                        sub.mst = latest_mst
                        
                        results.append({
                            "user_id": sub.user_id,
                            "law_name": sub.law_name,
                            "status": "updated",
                            "new_date": latest_date,
                            "amendment_type": amendment_type
                        })
                
            except Exception as e:
                print(f"Error checking update for subscription {sub.id} ({sub.law_name}): {e}")
                
        db.commit()
        return results

    async def subscribe_law(self, db: Session, user_id: int, law_name: str) -> Optional[Subscription]:
        """
        Subscribe a user to a specific law.
        """
        # Check if already subscribed
        existing = db.query(Subscription).filter(
            Subscription.user_id == user_id, 
            Subscription.law_name == law_name
        ).first()
        if existing:
            return existing
            
        try:
            # Get current info to store as baseline
            search_res = await law_client.search_laws(law_name)
            laws = search_res.get("law", [])
            if isinstance(laws, dict): laws = [laws]
            
            best_match = None
            if laws:
                for l in laws:
                    if l.get("법령명한글") == law_name:
                        best_match = l
                        break
                if not best_match: best_match = laws[0]
            
            mst = str(best_match.get("법령일련번호")) if best_match else ""
            last_date = str(best_match.get("시행일자")) if best_match else ""
            
            new_sub = Subscription(
                user_id=user_id,
                law_name=law_name,
                mst=mst,
                last_enforced_date=last_date
            )
            db.add(new_sub)
            db.commit()
            db.refresh(new_sub)
            return new_sub
        except Exception as e:
            print(f"Error subscribing to {law_name}: {e}")
            return None

    async def unsubscribe_law(self, db: Session, user_id: int, law_name: str) -> bool:
        """
        Unsubscribe a user from a specific law.
        """
        sub = db.query(Subscription).filter(
            Subscription.user_id == user_id, 
            Subscription.law_name == law_name
        ).first()
        if sub:
            db.delete(sub)
            db.commit()
            return True
        return False

    def get_subscriptions(self, db: Session, user_id: int) -> List[Subscription]:
        return db.query(Subscription).filter(Subscription.user_id == user_id).all()

    def get_notifications(self, db: Session, user_id: int) -> List[Notification]:
        return db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.created_at.desc()).all()

    def mark_notification_as_read(self, db: Session, user_id: int, notification_id: int) -> bool:
        notification = db.query(Notification).filter(
            Notification.id == notification_id, 
            Notification.user_id == user_id
        ).first()
        if notification:
            notification.is_read = 1
            db.commit()
            return True
        return False

    def mark_all_notifications_as_read(self, db: Session, user_id: int) -> int:
        notifications = db.query(Notification).filter(
            Notification.user_id == user_id,
            Notification.is_read == 0
        ).all()
        count = len(notifications)
        for n in notifications:
            n.is_read = 1
        db.commit()
        return count

legal_watch_engine = LegalWatchEngine()
