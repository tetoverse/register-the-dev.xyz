# the-dev.xyz

Free `*.the-dev.xyz` subdomains for developers, personal portfolios, and open-source projects.

## Supported DNS Records

| Record Type | Description | Notes |
| :--- | :--- | :--- |
| `A` | IPv4 address | Supports single string or array of IPs (no private/local IPs) |
| `AAAA` | IPv6 address | Supports single string or array of IPs |
| `CNAME` | Canonical name | Single string only; cannot be combined with other record types |
| `TXT` | Text record | Supports single string or array (e.g., domain verification) |

## How to Get a Subdomain

1. **Deploy your website first:** Make sure your site is live and accessible (e.g., via Vercel, GitHub Pages, Netlify, or your own server). Blank or "under construction" sites will be rejected.
2. **Fork this repository:** Click **Fork** at the top right of [`tetoverse/register-the-dev.xyz`](https://github.com/tetoverse/register-the-dev.xyz/).
3. **Create your domain file:** Inside the `domains/` directory, create a new lowercase JSON file named `<your-subdomain>.json` (for example, `domains/alex.json` registers `alex.the-dev.xyz`).
4. **Add your configuration:** Copy one of the examples below and replace the values with your own details.
5. **Open a Pull Request:** Submit a PR to the `main` branch, fill out the PR template with your live website preview URL, and wait for automated checks and maintainer review.

## Configuration Examples

### Vercel / GitHub Pages (`CNAME`)
```json
{
  "owner": {
    "username": "your-github-username",
    "email": "you@example.com"
  },
  "records": {
    "CNAME": "cname.vercel-dns.com"
  }
}
```

### VPS / Dedicated Server (`A` Record)
```json
{
  "owner": {
    "username": "your-github-username",
    "email": "you@example.com"
  },
  "records": {
    "A": ["1.2.3.4"]
  }
}
```

### Domain Verification (`TXT` Record / Nested Subdomain)
To add a nested subdomain (such as `_vercel.alex.the-dev.xyz` or `api.alex.the-dev.xyz`), your parent file (`domains/alex.json`) must already exist and belong to you:
```json
{
  "owner": {
    "username": "your-github-username",
    "email": "you@example.com"
  },
  "records": {
    "TXT": "vc-domain-verify=alex.the-dev.xyz,00000000000000000000"
  }
}
```

## Rules & Requirements

- **Ownership:** `owner.username` must exactly match the GitHub account opening the Pull Request.
- **Formatting:** Filenames must be completely lowercase. Do not include `http://`, `https://`, or trailing slashes in DNS record values.
- **Record Limits:** `CNAME` records cannot be combined with any other record types in the same file.
- **No Abuse:** Phishing, malware, spam, URL shorteners/redirects without a real project, or illegal content are strictly prohibited. Violating subdomains will be revoked immediately.

## Report Abuse

If you notice any `*.the-dev.xyz` subdomain engaging in phishing, malware distribution, spam, or any illegal activity, please report it immediately so we can revoke it:

- **Recommended:** [Open a GitHub Issue](https://github.com/tetoverse/register-the-dev.xyz/issues/new) with the offending subdomain and a brief description.
- **Email:** Send a report to [`contact@the-dev.xyz`](mailto:contact@the-dev.xyz).
