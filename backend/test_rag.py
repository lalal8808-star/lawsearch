import asyncio
import os
from engine.rag import RAGEngine

async def test():
    try:
        print("Initializing RAG Engine...")
        engine = RAGEngine()
        print("Engine initialized. Testing query...")
        result = await engine.query("안녕하세요")
        print(f"Result: {result['answer']}")
        print(f"Intent: {result['intent']}")
        print(f"Engine: {result['engine']}")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
