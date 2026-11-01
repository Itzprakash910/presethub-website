# v3.24.0 — footer unification + cache refresh

- One footer for every page (index, about, blog, contact, cookies, creator-program, creator, download-app, download-guide, faq, lightroom-guide, privacy, refund-policy, terms, tools, admin). Markup copied from the home page.
- style.css: new canonical footer block at the end (grid 1.7fr/1fr/1fr/1fr, h3 1.17rem bold, no link underline, margin-top 48px). Mobile (<=760px): 2 columns, brand full width.
- content.css: removed footer overrides (grid 1.4fr, 40px margin, underline on all footer links, 0.95rem headings) that made inner pages look different.
- privacy, refund-policy, tools: added missing icons.css, cookie-consent.css and Google Fonts so footer icons and fonts render.
- creator.html: footer added (it had none).
- Footer "All Presets" was listed twice; the second link (/presets/) is now "Preset Library".
- sw.js: cache bumped to v16 and style.css version updated so users get the new footer.
