# SECURITY — StudyBench

Secrets, credentials, single-owner access, URL retrieval, and logging.

**Read before:** handling credentials or secrets, adding the production access
gate, fetching a remote URL, or adding log statements.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` section 19.

---

## 1. Secrets

Never commit:

- AWS credentials
- Database passwords
- Session secrets
- Owner-password hashes
- API keys
- Signed URLs
- Real voice recordings
- Personal source documents

Do not print secrets in logs or completion reports.

---

## 2. AWS credentials

Production AWS access must use the ECS task role.

Do not embed credentials in:

- Source code
- Docker images
- Client-side JavaScript
- Configuration committed to Git

---

## 3. Single-owner access

Single-user does not mean publicly unrestricted.

When production access protection is authorized:

- Do not create registration.
- Do not create a users table.
- Do not add organization or role concepts.
- Protect state-changing operations.
- Use secure HTTP-only cookies if application-level sessions are used.
- Keep credentials in a secret-management mechanism.

---

## 4. URL retrieval

When source URL import is authorized, retrieval must defend against server-side
request forgery.

At minimum:

- Allow only HTTP and HTTPS
- Reject loopback addresses
- Reject private-network destinations unless deliberately approved
- Revalidate redirects
- Apply timeouts
- Limit response size
- Restrict content types
- Sanitize rendered content

---

## 5. Logs

Logs may include:

- Request correlation ID
- Operation name
- Duration
- Safe entity IDs
- Safe error category

Logs must not include:

- Full prompts by default
- Full source documents
- Correct answers unnecessarily
- Voice recording contents
- Database credentials
- AWS credentials
- Cookies
- Session secrets
