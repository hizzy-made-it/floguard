import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("indexnow", Path(__file__).with_name("indexnow.py"))
indexnow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexnow)


class IndexNowTest(unittest.TestCase):
    def test_source_assets_and_sample_pages(self):
        key = indexnow.key_from(indexnow.PUBLIC)
        self.assertEqual(len(key), 32)
        urls = indexnow.sitemap_urls((indexnow.PUBLIC / "sitemap.xml").read_text(encoding="utf-8"))
        self.assertIn(indexnow.ORIGIN + "/", urls)
        self.assertIn(indexnow.ORIGIN + "/services/french-drains", urls)

    def test_reject_noncanonical_and_duplicate_urls(self):
        def sitemap(*urls):
            return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(
                f"<url><loc>{url}</loc></url>" for url in urls
            ) + "</urlset>"

        for bad in ("https://www.floguardfl.com/", "http://floguardfl.com/", indexnow.ORIGIN + "/areas/", indexnow.ORIGIN + "/?foo=1"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                indexnow.sitemap_urls(sitemap(bad))
        with self.assertRaises(ValueError):
            indexnow.sitemap_urls(sitemap(indexnow.ORIGIN + "/", indexnow.ORIGIN + "/"))

    def test_checks_live_key_not_html_or_wrong_key(self):
        class Headers:
            def get_content_type(self):
                return "text/html"

        with patch.object(indexnow, "request", return_value=(200, Headers(), "key")) as request:
            with self.assertRaisesRegex(ValueError, "expected plain text"):
                indexnow.check(indexnow.ORIGIN, "key", [], 1, False)
            request.assert_called_once_with(indexnow.ORIGIN + "/key.txt")

    def test_detects_obfuscation_and_noindex(self):
        html = '<link rel="canonical" href="https://floguardfl.com/"><meta name="robots" content="noindex"><a href="/cdn-cgi/l/email-protection#abc">Email</a>'
        meta = indexnow.Metadata(html)
        self.assertEqual(meta.canonicals, [indexnow.ORIGIN + "/"])
        self.assertEqual(meta.obfuscated_links, 1)
        self.assertTrue(meta.noindex)


if __name__ == "__main__":
    unittest.main()
