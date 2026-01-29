import httpx
import xmltodict
import os
from dotenv import load_dotenv
from typing import List, Dict, Any, Optional

load_dotenv()

BASE_URL = "http://www.law.go.kr/DRF"
OC_ID = os.getenv("LAW_OC_ID", "test") # Default to test if not provided

class LawClient:
    def __init__(self, oc_id: str = OC_ID):
        self.oc_id = oc_id
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_laws(self, query: str, target: str = "law", page: int = 1) -> Dict[str, Any]:
        """
        Search for laws based on query.
        """
        params = {
            "OC": self.oc_id,
            "target": target,
            "type": "XML",
            "query": query,
            "page": page,
            "display": 20
        }
        response = await self.client.get(f"{BASE_URL}/lawSearch.do", params=params)
        response.raise_for_status()
        
        try:
            data = xmltodict.parse(response.text)
            return data.get("LawSearch", {})
        except Exception as e:
            if "<html" in response.text.lower():
                raise Exception("The Law API returned an HTML error page. Please check your LAW_OC_ID.")
            raise Exception(f"Failed to parse Law API response: {e}")

    async def search_precedents(self, query: str, page: int = 1) -> Dict[str, Any]:
        """
        Search for precedents (판례) based on query.
        """
        params = {
            "OC": self.oc_id,
            "target": "prec",
            "type": "XML",
            "query": query,
            "page": page,
            "display": 20
        }
        response = await self.client.get(f"{BASE_URL}/lawSearch.do", params=params)
        response.raise_for_status()
        
        try:
            data = xmltodict.parse(response.text)
            return data.get("PrecSearch", {})
        except Exception as e:
            if "<html" in response.text.lower():
                raise Exception("The Law API returned an HTML error page. Please check your LAW_OC_ID.")
            raise Exception(f"Failed to parse Prec API response: {e}")

    async def get_law_detail(self, mst: str) -> Dict[str, Any]:
        """
        Fetch full law text by MST (Law Master Number).
        """
        params = {
            "OC": self.oc_id,
            "target": "law",
            "type": "XML",
            "MST": mst,
            "mobileYn": "Y"
        }
        response = await self.client.get(f"{BASE_URL}/lawService.do", params=params)
        response.raise_for_status()
        
        try:
            data = xmltodict.parse(response.text)
            return data.get("법령", {})
        except Exception as e:
            if "<html" in response.text.lower():
                raise Exception("The Law API returned an HTML error page. Please check your LAW_OC_ID.")
            raise Exception(f"Failed to parse Law API response: {e}")

    async def get_precedent_detail(self, prec_id: str) -> Dict[str, Any]:
        """
        Fetch full precedent text by ID.
        """
        params = {
            "OC": self.oc_id,
            "target": "prec",
            "type": "XML",
            "ID": prec_id,
            "mobileYn": "Y"
        }
        response = await self.client.get(f"{BASE_URL}/lawService.do", params=params)
        response.raise_for_status()
        
        try:
            data = xmltodict.parse(response.text)
            return data.get("판례정보", {})
        except Exception as e:
            if "<html" in response.text.lower():
                raise Exception("The Law API returned an HTML error page. Please check your LAW_OC_ID.")
            raise Exception(f"Failed to parse Prec Detail API response: {e}")

    async def close(self):
        await self.client.aclose()

# Singleton instance
law_client = LawClient()
