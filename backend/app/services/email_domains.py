"""Email domains anyone can sign up with. They identify a mail provider, not a school,
so they must never group teachers (or their students) together (#3541)."""

PUBLIC_EMAIL_DOMAINS: frozenset[str] = frozenset({
    "gmail.com", "googlemail.com",
    "yahoo.com", "yahoo.com.tw", "ymail.com",
    "hotmail.com", "hotmail.com.tw", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com",
    "protonmail.com", "proton.me",
    "msa.hinet.net", "hinet.net", "pchome.com.tw", "seed.net.tw",
    "qq.com", "163.com", "126.com", "aol.com", "gmx.com", "mail.com",
})


def is_public_email_domain(domain: str | None) -> bool:
    return bool(domain) and domain.strip().lower() in PUBLIC_EMAIL_DOMAINS
