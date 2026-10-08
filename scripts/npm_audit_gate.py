#!/usr/bin/env python3
"""Fail CI on high/critical npm advisories that are not allowlisted (#3340).

Usage: npm_audit_gate.py <npm-audit.json> <.security-audit-allowlist.json>

`npm audit` has no `--ignore` flag (unknown flags are swallowed silently), so
the allowlist has to be applied to the `--json` report here. Entries in the
allowlist's "npm" list match an advisory by npm source id ("1240992") or by
GHSA id ("GHSA-vfj7-8cjw-p6xm"), and every entry needs a `_justifications`
line. Packages that are only vulnerable *through* an allowlisted advisory
(e.g. tailwindcss -> chokidar -> braces) clear with it, because only the
advisory objects themselves are judged.

Exit codes: 0 clean, 1 blocking advisories, 2 unusable report/allowlist.
"""
import json
import sys

BLOCKING_SEVERITIES = {"high", "critical"}


class GateError(Exception):
    pass


def _ghsa(adv):
    url = adv.get("url") or ""
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    return tail if tail.startswith("GHSA-") else None


def _ids(adv):
    """Allowlist-matchable ids. An advisory with neither a source id nor a
    GHSA id gets an empty set, so it can never be allowlisted."""
    ids = set()
    if adv.get("source") is not None:
        ids.add(str(adv["source"]))
    ghsa = _ghsa(adv)
    if ghsa:
        ids.add(ghsa)
    return ids


def _identity(adv):
    # Dedup key. `source` alone is not enough: if it is missing, every
    # advisory would collapse onto None and the first one would hide the rest.
    return (
        adv.get("source"),
        _ghsa(adv),
        adv.get("url"),
        adv.get("name"),
        adv.get("title"),
        adv.get("range"),
    )


def validate_allowlist(allowlist):
    entries = [str(e) for e in allowlist.get("npm", [])]
    justifications = allowlist.get("_justifications", {})
    missing = [e for e in entries if not str(justifications.get(e, "")).strip()]
    if missing:
        raise GateError(f"npm allowlist entries without _justifications: {missing}")
    return set(entries)


def _reconcile(report):
    """Fail closed unless every high/critical the report claims is explained
    by an advisory object we can actually judge.

    npm's metadata.vulnerabilities counts *packages* by severity (tailwindcss,
    chokidar, ... each count), not advisories, so the check is: metadata
    high+critical == high/critical package entries, and each of those entries
    reaches a high/critical advisory through its `via` chain.
    """
    vulns = report["vulnerabilities"]
    counts = (report.get("metadata") or {}).get("vulnerabilities")
    if not isinstance(counts, dict):
        raise GateError("npm audit report has no metadata.vulnerabilities counts")
    try:
        claimed = sum(int(counts.get(s, 0)) for s in BLOCKING_SEVERITIES)
    except (TypeError, ValueError):
        raise GateError(f"unreadable metadata.vulnerabilities: {counts}")
    entries = [k for k, v in vulns.items() if v.get("severity") in BLOCKING_SEVERITIES]
    if claimed != len(entries):
        raise GateError(
            f"metadata reports {claimed} high/critical but {len(entries)} "
            f"high/critical package entries were found: {sorted(entries)}"
        )

    def reaches_advisory(name, seen):
        if name in seen or name not in vulns:
            return False
        seen.add(name)
        for via in vulns[name].get("via", []):
            if isinstance(via, dict):
                if via.get("severity") in BLOCKING_SEVERITIES:
                    return True
            elif reaches_advisory(via, seen):
                return True
        return False

    orphans = [k for k in entries if not reaches_advisory(k, set())]
    if orphans:
        raise GateError(f"high/critical packages with no traceable advisory: {sorted(orphans)}")


def _advisories(report):
    if "error" in report or not isinstance(report.get("vulnerabilities"), dict):
        raise GateError(f"not a usable npm audit report: {json.dumps(report)[:300]}")
    _reconcile(report)
    seen = {}
    for vuln in report["vulnerabilities"].values():
        for via in vuln.get("via", []):
            if isinstance(via, dict):  # strings are transitive pointers, not advisories
                seen.setdefault(_identity(via), via)
    return list(seen.values())


def blocking_advisories(report, allowlist):
    allowed = validate_allowlist(allowlist)
    return [
        adv
        for adv in _advisories(report)
        if adv.get("severity") in BLOCKING_SEVERITIES and not (_ids(adv) & allowed)
    ]


def _line(adv):
    return f"  [{adv.get('severity')}] {adv.get('name')} {_ghsa(adv) or adv.get('source')} — {adv.get('title')}"


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    try:
        with open(argv[1]) as f:
            report = json.load(f)
        with open(argv[2]) as f:
            allowlist = json.load(f)
        blocking = blocking_advisories(report, allowlist)
        allowed = validate_allowlist(allowlist)
    except (OSError, ValueError, GateError) as e:
        print(f"npm audit gate: {e}")
        return 2

    skipped = [
        a for a in _advisories(report)
        if a.get("severity") in BLOCKING_SEVERITIES and _ids(a) & allowed
    ]
    for adv in skipped:
        print("allowlisted:" + _line(adv))
    if blocking:
        print(f"npm audit gate FAILED: {len(blocking)} high/critical advisory(ies) not allowlisted")
        for adv in blocking:
            print(_line(adv))
        return 1
    print("npm audit gate passed — no un-allowlisted high/critical advisories")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
