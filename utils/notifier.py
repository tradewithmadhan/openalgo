"""
Generic real-time notification emitter via Socket.IO.

Usage:
    from utils.notifier import emit_notification

    emit_notification(
        event_type='app_notification',
        title='Bullish Signal',
        message='NIFTY 24000 CE @ ₹147.81',
        category='madhan',
        level='success',
        data={'strike': 24000, 'ltp': 147.81}
    )
"""

from datetime import datetime, timezone, timedelta
from extensions import socketio

IST = timezone(timedelta(hours=5, minutes=30))


def emit_notification(event_type, title, message, category='madhan', level='success', data=None):
    payload = {
        'title': title,
        'message': message,
        'category': category,
        'level': level,
        'time': datetime.now(IST).isoformat(),
    }
    if data:
        payload['data'] = data
    socketio.emit(event_type, payload)
