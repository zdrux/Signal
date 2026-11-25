import ssl
from ldap3 import Server, Connection, ALL, Tls, NTLM
from ldap3.utils.conv import escape_filter_chars
from sqlmodel import Session

from app.config import normalize_username
from app.services.config_store import get_all_config


def _lookup_display_name(server: Server, conn: Connection, username: str, cfg: dict[str, str]) -> str:
    """Query the authenticated user's own AD entry for their full name (no bind ID needed)."""
    try:
        search_base = (cfg.get("LDAP_USER_SEARCH_BASE") or "").strip()
        if not search_base and server.info and server.info.other:
            contexts = server.info.other.get("defaultNamingContext")
            if contexts:
                search_base = str(contexts[0])
        if not search_base:
            return ""

        sam = escape_filter_chars(normalize_username(username))
        conn.search(
            search_base=search_base,
            search_filter=f"(sAMAccountName={sam})",
            attributes=["displayName", "cn", "givenName", "sn"],
            size_limit=1,
        )
        if not conn.entries:
            return ""

        entry = conn.entries[0]
        if "displayName" in entry and entry.displayName.value:
            return str(entry.displayName.value).strip()
        given = str(entry.givenName.value).strip() if ("givenName" in entry and entry.givenName.value) else ""
        sn = str(entry.sn.value).strip() if ("sn" in entry and entry.sn.value) else ""
        if given or sn:
            return f"{given} {sn}".strip()
        if "cn" in entry and entry.cn.value:
            return str(entry.cn.value).strip()
    except Exception as exc:
        print(f"LDAP displayName lookup skipped for {username}: {exc}")
    return ""


def authenticate_ldap(username: str, password: str, session: Session) -> tuple[bool, str]:
    """Simple LDAPS pass-through bind without a dedicated bind ID. Returns (ok, display_name)."""
    if not username or not password:
        return False, ""

    cfg = get_all_config(session)
    ldap_host = (cfg.get("LDAP_HOST") or "").strip()
    ldap_port = int(cfg.get("LDAP_PORT") or 636)
    use_ssl = str(cfg.get("LDAP_USE_SSL", "true")).strip().lower() in ("true", "1", "yes")
    ldap_domain = (cfg.get("LDAP_USER_DOMAIN") or "").strip()
    auth_type = (cfg.get("LDAP_AUTH_TYPE") or "SIMPLE").strip().upper()

    if not ldap_host:
        return False, ""

    try:
        tls = Tls(validate=ssl.CERT_NONE) if use_ssl else None
        server = Server(ldap_host, port=ldap_port, use_ssl=use_ssl, tls=tls, get_info=ALL)

        user_str = username.strip()
        if ldap_domain and "\\" not in user_str and "@" not in user_str:
            user_str = f"{ldap_domain}\\{user_str}"

        if auth_type == "NTLM":
            conn = Connection(server, user=user_str, password=password, authentication=NTLM)
        else:
            conn = Connection(server, user=user_str, password=password)

        bound = bool(conn.bind())
        if not bound:
            return False, ""

        display_name = _lookup_display_name(server, conn, username, cfg)
        conn.unbind()
        return True, display_name
    except Exception as exc:
        print(f"LDAP Auth Error for {username}: {exc}")
        return False, ""
