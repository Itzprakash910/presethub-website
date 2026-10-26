# PresetHub v3.13.0 — SEO meta everywhere

## Static pages (About, Blog, Contact, FAQ, Cookies, Privacy, Terms, Creator Programme, Lightroom Guide, Download Guide, Download App, Tools)
- Every page now has: title, meta description, keywords, robots, canonical, Open Graph (title, description, image 1200×630, locale hi_IN), Twitter card, hreflang (hi, en-IN, x-default), and JSON-LD (WebPage + Breadcrumb).
- Titles kept under about 60 characters and descriptions under 160 so Google shows them in full.
- Admin and Creator dashboard are `noindex` (private).

## Presets (preset detail page)
- Search description now starts with the preset name, creator, price and format ("Sunset Glow Lightroom preset by Ravi — ₹49 · XMP & DNG."), then the creator's own words. Keywords include name, category, tags, XMP, DNG and mobile preset terms.
- Product structured data (name, price, image) is already on the page.

## Shayari and text prompts
- Pages already have server-rendered titles, descriptions, keywords and JSON-LD (CreativeWork). Unchanged, verified.

## Hashtags, categories, creator profiles
- Already server-rendered with title, description, keywords and JSON-LD. Unchanged, verified.

## Sitemap
- Each preset appears once (before, some presets were listed twice).
- Preset preview images are included so Google Images can show them.

## Checks run
- Every indexable HTML page: title, description, keywords, canonical, og:image, twitter:card and JSON-LD present, and the JSON-LD parses.
- Syntax and local links and requires pass.

## Still needed from you (outside the code)
- Submit the sitemap at https://presethub.site/sitemap.xml in Google Search Console and check Coverage.
- Google decides ranking over time. Good pages, backlinks and regular new content matter as much as meta tags.
