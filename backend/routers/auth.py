import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

router = APIRouter()
security = HTTPBearer()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _secret() -> str:
    return os.getenv("JWT_SECRET", "secret")


def create_token(username: str) -> str:
    expiry = int(os.getenv("JWT_EXPIRY_DAYS", "7"))
    payload = {
        "sub": username,
        "exp": datetime.utcnow() + timedelta(days=expiry),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def verify_token(token: str) -> str:
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    return verify_token(credentials.credentials)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/login")
def login(req: LoginRequest):
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "changeme")
    if req.username != admin_user or req.password != admin_pass:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(req.username)
    return {"token": token, "username": req.username}


@router.get("/verify")
def verify(user: str = Depends(get_current_user)):
    return {"valid": True, "username": user}
