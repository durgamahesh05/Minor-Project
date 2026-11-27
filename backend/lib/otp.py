import secrets


def generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"
