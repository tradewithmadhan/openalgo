"""
Zerodha Personal (enctoken) WebSocket streaming module for OpenAlgo.

This module provides WebSocket integration with Zerodha's market data streaming API,
following the OpenAlgo WebSocket proxy architecture.
"""

from .zerodhaenctoken_adapter import ZerodhaenctokenWebSocketAdapter

__all__ = ["ZerodhaenctokenWebSocketAdapter"]
