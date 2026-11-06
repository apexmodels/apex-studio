"""
Apex Studio Web Search and Scraping Engine.
Enables ApexPhi-Think to autonomously explore external documentation, libraries, and APIs.
"""

import logging
import ssl
import urllib.request
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
from ddgs import DDGS

logger = logging.getLogger("apex_studio.web_tools")

# Standard headers to prevent bot-blocking on public documentation sites
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 "
        "ApexStudio/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def search_web(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Search DuckDuckGo for documentation, APIs, and code examples.

    Args:
        query: Search keywords or query string.
        max_results: Maximum number of links to return (default: 5).

    Returns:
        List of dicts with 'title', 'href', and 'body' snippets.
    """
    logger.info("Executing web search: %s (max_results=%d)", query, max_results)
    results: List[Dict[str, str]] = []
    try:
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
            for item in raw_results:
                results.append({
                    "title": item.get("title", ""),
                    "href": item.get("href", ""),
                    "body": item.get("body", "")
                })
    except Exception as e:
        logger.warning("DuckDuckGo search error: %s", e)
        # Return fallback format on network glitch
        results.append({
            "title": f"Search failed for {query}",
            "href": "",
            "body": f"Error during search: {str(e)}"
        })
    return results


def fetch_page_content(url: str, max_chars: int = 6000) -> Dict[str, Any]:
    """Fetch and sanitize webpage content, stripping boilerplate, ads, and scripts.

    Extracts clean article/documentation text, code blocks, and headers.

    Args:
        url: Absolute HTTP/HTTPS URL.
        max_chars: Character limit to avoid context window explosion (default: 6000).

    Returns:
        Dict with 'url', 'title', 'content', and 'status'.
    """
    logger.info("Fetching webpage: %s", url)
    if not url.startswith("http://") and not url.startswith("https://"):
        return {"url": url, "title": "Invalid URL", "content": "URL must begin with http:// or https://", "status": "error"}

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # Allow internal/dev certs if necessary

        req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                return {
                    "url": url,
                    "title": "Unsupported Content Type",
                    "content": f"Non-text content-type: {content_type}",
                    "status": "skipped"
                }

            html = resp.read().decode("utf-8", errors="ignore")
            soup = BeautifulSoup(html, "html.parser")

            # Remove non-content elements
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "svg", "noscript", "iframe"]):
                tag.decompose()

            title = soup.title.string.strip() if soup.title and soup.title.string else url

            # Find main content container if available
            main_el = soup.find("main") or soup.find("article") or soup.find("div", class_="content") or soup.body
            if main_el:
                # Format code blocks with backticks
                for pre in main_el.find_all("pre"):
                    code = pre.get_text()
                    pre.replace_with(f"\n```\n{code}\n```\n")

                text = main_el.get_text(separator="\n", strip=True)
            else:
                text = soup.get_text(separator="\n", strip=True)

            # Collapse redundant newlines
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            cleaned_text = "\n".join(lines)

            if len(cleaned_text) > max_chars:
                cleaned_text = cleaned_text[:max_chars] + f"\n\n[... Truncated at {max_chars} chars ...]"

            return {
                "url": url,
                "title": title,
                "content": cleaned_text,
                "status": "success"
            }

    except Exception as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return {
            "url": url,
            "title": "Fetch Error",
            "content": f"Error fetching {url}: {str(e)}",
            "status": "error"
        }
