from fastapi import Depends, HTTPException, Request
from bson import ObjectId


def require_auth(request: Request):
    user_id = request.session.get("userId")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        identifier = ObjectId(user_id)
    except Exception as error:
        raise HTTPException(status_code=401, detail="Not authenticated") from error
    user = request.app.state.db.users.find_one({"_id": identifier})
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def get_current_user(request: Request):
    return require_auth(request)


def require_admin(user=Depends(require_auth)):
    if user.get("role", "user") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
