(function () {
  if (window.__BROKEN_WEBSITE_DETECTOR_ANALYZE__) {
    return;
  }

  window.__BROKEN_WEBSITE_DETECTOR_LOADED__ = true;

  const CTA_TERMS = [
    "contact",
    "book",
    "buy",
    "shop",
    "get started",
    "request",
    "call",
    "schedule",
    "quote",
    "consultation",
    "demo",
    "start",
    "sign up",
    "learn more"
  ];

  const TESTIMONIAL_TERMS = [
    "review",
    "reviews",
    "testimonial",
    "testimonials",
    "what our clients say",
    "customer feedback",
    "happy clients",
    "success stories"
  ];

  const TRUST_TERMS = [
    "certified",
    "certification",
    "award",
    "awards",
    "trusted by",
    "partner",
    "partners",
    "client logos",
    "years of experience",
    "guarantee",
    "guaranteed",
    "secure checkout",
    "insured",
    "licensed",
    "verified",
    "accredited"
  ];

  const PRICING_TERMS = [
    "pricing",
    "plans",
    "packages",
    "per month",
    "starting at",
    "subscription",
    "quote",
    "$",
    "€"
  ];

  const FAQ_TERMS = ["faq", "frequently asked", "common questions"];
  const SOCIAL_PLATFORMS = [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com"
  ];

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getVisibleText(element) {
    return normalizeWhitespace(element?.innerText || element?.textContent || "");
  }

  function normalizeFontFamily(fontFamily) {
    const firstFamily = (fontFamily || "")
      .split(",")[0]
      .replace(/["']/g, "")
      .trim();

    return firstFamily.toLowerCase();
  }

  function parseRgb(colorValue) {
    if (!colorValue) {
      return null;
    }

    const rgbaMatch = colorValue.match(/rgba?\(([^)]+)\)/i);
    if (!rgbaMatch) {
      return null;
    }

    const parts = rgbaMatch[1]
      .split(",")
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));

    if (parts.length < 3) {
      return null;
    }

    return {
      r: clamp(parts[0], 0, 255),
      g: clamp(parts[1], 0, 255),
      b: clamp(parts[2], 0, 255),
      a: parts.length > 3 ? clamp(parts[3], 0, 1) : 1
    };
  }

  function getEffectiveBackgroundColor(element) {
    let current = element;

    while (current && current !== document.documentElement) {
      const color = parseRgb(window.getComputedStyle(current).backgroundColor);
      if (color && color.a > 0.05) {
        return color;
      }

      current = current.parentElement;
    }

    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function relativeLuminance(channel) {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function getContrastRatio(foreground, background) {
    const foregroundLum =
      0.2126 * relativeLuminance(foreground.r) +
      0.7152 * relativeLuminance(foreground.g) +
      0.0722 * relativeLuminance(foreground.b);

    const backgroundLum =
      0.2126 * relativeLuminance(background.r) +
      0.7152 * relativeLuminance(background.g) +
      0.0722 * relativeLuminance(background.b);

    const lighter = Math.max(foregroundLum, backgroundLum);
    const darker = Math.min(foregroundLum, backgroundLum);

    return (lighter + 0.05) / (darker + 0.05);
  }

  function textContains(text, terms) {
    const normalized = (text || "").toLowerCase();
    return terms.some((term) => normalized.includes(term));
  }

  function matchesCta(text) {
    const normalized = (text || "").toLowerCase();
    return CTA_TERMS.some((term) => normalized.includes(term));
  }

  function collectInteractiveElements() {
    return Array.from(
      document.querySelectorAll(
        'a[href], button, input[type="submit"], input[type="button"], [role="button"]'
      )
    )
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = getVisibleText(element) || element.getAttribute("aria-label") || "";
        return {
          tagName: element.tagName.toLowerCase(),
          text: normalizeWhitespace(text).slice(0, 120),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      })
      .filter((item) => item.text || item.tagName === "button");
  }

  function analyzeHeroSection(viewportHeight) {
    // Hero detection is intentionally heuristic: version 1 looks for a large opening block
    // that combines a headline with support copy, CTA presence, media, or a large footprint.
    const candidateSelectors = [
      "header",
      "main > section",
      "main > div",
      "section",
      "article",
      "body > div"
    ];

    const candidates = Array.from(document.querySelectorAll(candidateSelectors.join(",")))
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < viewportHeight && rect.bottom > 0 && rect.height > 80;
      })
      .slice(0, 24);

    let best = {
      score: 0,
      hasHeading: false,
      hasSupportingText: false,
      hasCta: false,
      hasMedia: false,
      hasLargeFootprint: false
    };

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      const heading = Array.from(element.querySelectorAll("h1, h2, h3")).find(
        (node) => isVisible(node) && getVisibleText(node).length >= 12
      );
      const supportingText = Array.from(element.querySelectorAll("p, div, span")).find(
        (node) => isVisible(node) && getVisibleText(node).length >= 40
      );
      const cta = Array.from(
        element.querySelectorAll(
          'a[href], button, input[type="submit"], input[type="button"], [role="button"]'
        )
      ).find((node) => isVisible(node) && matchesCta(getVisibleText(node) || node.getAttribute("aria-label") || ""));
      const media =
        element.querySelector("img, picture, video, svg, canvas") ||
        window.getComputedStyle(element).backgroundImage !== "none";
      const hasLargeFootprint =
        rect.height >= viewportHeight * 0.35 || rect.width >= window.innerWidth * 0.85;

      const score =
        (heading ? 1.35 : 0) +
        (supportingText ? 0.75 : 0) +
        (cta ? 0.95 : 0) +
        (media ? 0.8 : 0) +
        (hasLargeFootprint ? 0.55 : 0);

      if (score > best.score) {
        best = {
          score,
          hasHeading: Boolean(heading),
          hasSupportingText: Boolean(supportingText),
          hasCta: Boolean(cta),
          hasMedia: Boolean(media),
          hasLargeFootprint
        };
      }
    }

    return {
      hasHero: best.score >= 2.35,
      ...best
    };
  }

  function getHeadingSignals() {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          level: Number.parseInt(element.tagName.slice(1), 10),
          text: getVisibleText(element).slice(0, 180),
          top: rect.top,
          fontSize: Number.parseFloat(style.fontSize) || 0
        };
      });

    const levelCounts = headings.reduce(
      (accumulator, heading) => {
        accumulator[`h${heading.level}`] += 1;
        return accumulator;
      },
      { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
    );

    let skipCount = 0;
    for (let index = 1; index < headings.length; index += 1) {
      if (headings[index].level - headings[index - 1].level > 1) {
        skipCount += 1;
      }
    }

    const weakStructure =
      levelCounts.h1 === 0 ||
      skipCount >= 2 ||
      (levelCounts.h1 >= 1 && levelCounts.h2 === 0 && headings.length >= 3);

    return {
      headings,
      levelCounts,
      weakStructure
    };
  }

  function getTypographySignals() {
    const textElements = Array.from(
      document.querySelectorAll("p, li, span, a, button, h1, h2, h3, h4, h5, h6")
    )
      .filter(isVisible)
      .slice(0, 180);

    const fontFamilies = new Set();
    const headingSizes = [];
    const bodySizes = [];
    let contrastRiskCount = 0;
    let contrastSampleCount = 0;

    for (const element of textElements) {
      const text = getVisibleText(element);
      if (text.length < 4) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const fontFamily = normalizeFontFamily(style.fontFamily);
      if (fontFamily) {
        fontFamilies.add(fontFamily);
      }

      if (/^h[1-6]$/i.test(element.tagName)) {
        headingSizes.push(fontSize);
      } else if (rect.width > 90) {
        bodySizes.push(fontSize);
      }

      if (contrastSampleCount < 80) {
        const foreground = parseRgb(style.color);
        const background = getEffectiveBackgroundColor(element);
        if (foreground && background) {
          contrastSampleCount += 1;
          const contrastRatio = getContrastRatio(foreground, background);
          if (contrastRatio < 4.5) {
            contrastRiskCount += 1;
          }
        }
      }
    }

    const averageBodyFontSize =
      bodySizes.length > 0
        ? bodySizes.reduce((sum, value) => sum + value, 0) / bodySizes.length
        : 0;

    const maxHeadingSize = headingSizes.length > 0 ? Math.max(...headingSizes) : 0;
    const hasVisualHierarchy =
      maxHeadingSize >= averageBodyFontSize + 8 && headingSizes.length > 0;

    return {
      fontFamilies: Array.from(fontFamilies),
      fontFamilyCount: fontFamilies.size,
      averageBodyFontSize: Number(averageBodyFontSize.toFixed(1)),
      maxHeadingSize: Number(maxHeadingSize.toFixed(1)),
      contrastRiskCount,
      contrastSampleCount,
      hasVisualHierarchy
    };
  }

  function getContactSignals(bodyText) {
    const emailPattern =
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const phonePattern =
      /(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s().-]*)?\d{3}[\s.-]?\d{3,4}\b/;
    const addressPattern =
      /\b\d{1,5}\s+[A-Za-z0-9.\-'\s]{2,40}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|suite|ste)\b/i;

    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
    const contactForms = Array.from(document.forms).filter((form) => {
      const formText = getVisibleText(form).toLowerCase();
      return (
        isVisible(form) &&
        form.querySelector('input[type="email"], input[type="tel"], textarea') &&
        (formText.includes("contact") || formText.includes("message") || formText.includes("quote"))
      );
    });

    const bodyTextLower = bodyText.toLowerCase();
    const socialLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
      .map((anchor) => anchor.href)
      .filter((href) => SOCIAL_PLATFORMS.some((platform) => href.includes(platform)));

    const schemaScripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    )
      .map((script) => script.textContent || "")
      .join("\n")
      .toLowerCase();

    const serviceTerms = [
      "plumber",
      "dentist",
      "law firm",
      "clinic",
      "contractor",
      "repair",
      "roofing",
      "salon",
      "agency",
      "studio",
      "restaurant",
      "cafe",
      "home services"
    ];

    const localKeywords = ["visit us", "our office", "serving", "locations", "find us", "hours"];

    return {
      hasEmail: mailtoLinks.length > 0 || emailPattern.test(bodyText),
      hasPhone: telLinks.length > 0 || phonePattern.test(bodyText),
      hasAddress: addressPattern.test(bodyText) || schemaScripts.includes("localbusiness"),
      hasContactForm: contactForms.length > 0,
      socialLinkCount: socialLinks.length,
      socialPlatforms: Array.from(
        new Set(
          socialLinks
            .map((href) => SOCIAL_PLATFORMS.find((platform) => href.includes(platform)) || "")
            .filter(Boolean)
            .map((href) => href.replace(".com", ""))
        )
      ),
      likelyLocalBusiness:
        schemaScripts.includes("localbusiness") ||
        (serviceTerms.some((term) => bodyTextLower.includes(term)) &&
          (localKeywords.some((term) => bodyTextLower.includes(term)) ||
            phonePattern.test(bodyText))),
      looksCommercial:
        /(?:services|pricing|book|quote|shop|buy|plans|packages|consultation|demo)/i.test(
          bodyText
        )
    };
  }

  function getTrustSignals(bodyText) {
    const lowerText = bodyText.toLowerCase();
    const starPattern = /(?:4\.\d|5\.0)\s*\/\s*5|★★★★★|⭐/;

    const testimonialByDom =
      document.querySelector('[class*="testimonial"], [id*="testimonial"], blockquote') !== null;
    const trustByDom =
      document.querySelector('[class*="partner"], [class*="client-logo"], [class*="badge"]') !== null;
    const faqByDom =
      document.querySelector("details, [aria-expanded], [class*='faq'], [id*='faq']") !== null;

    const hasTestimonials = testimonialByDom || textContains(lowerText, TESTIMONIAL_TERMS) || starPattern.test(bodyText);
    const hasTrustSignals = trustByDom || textContains(lowerText, TRUST_TERMS);
    const hasPricing = textContains(lowerText, PRICING_TERMS);
    const hasFaq = faqByDom || textContains(lowerText, FAQ_TERMS);
    const hasSocialProof =
      hasTestimonials ||
      /trusted by|clients include|used by|over \d+ clients|over \d+ customers|case study/i.test(bodyText);

    return {
      hasTestimonials,
      hasTrustSignals,
      hasPricing,
      hasFaq,
      hasSocialProof
    };
  }

  function getImageSignals() {
    const images = Array.from(document.images);
    const missingAltImages = images.filter((image) => {
      const alt = image.getAttribute("alt");
      const rect = image.getBoundingClientRect();
      const isMeaningfulSize = rect.width >= 80 && rect.height >= 80;
      return isMeaningfulSize && (!image.hasAttribute("alt") || normalizeWhitespace(alt) === "");
    });

    return {
      imageCount: images.length,
      missingAltCount: missingAltImages.length
    };
  }

  function getFormSignals() {
    const controls = Array.from(
      document.querySelectorAll("input, select, textarea")
    ).filter((control) => {
      const type = (control.getAttribute("type") || "").toLowerCase();
      return type !== "hidden" && !control.disabled && isVisible(control);
    });

    const unlabeledControls = controls.filter((control) => {
      const id = control.id;
      const hasForLabel = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null
        : false;
      const wrappedByLabel = control.closest("label") !== null;
      const ariaLabel = control.getAttribute("aria-label");
      const ariaLabelledBy = control.getAttribute("aria-labelledby");
      return !hasForLabel && !wrappedByLabel && !ariaLabel && !ariaLabelledBy;
    });

    return {
      formCount: document.forms.length,
      controlCount: controls.length,
      unlabeledControlCount: unlabeledControls.length
    };
  }

  function getTechnicalSignals() {
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    let domContentLoadedMs = null;
    let loadMs = null;

    // This is a lightweight performance estimate, not a Lighthouse replacement.
    if (navigationEntry) {
      domContentLoadedMs = Math.round(
        navigationEntry.domContentLoadedEventEnd - navigationEntry.startTime
      );
      loadMs = Math.round(navigationEntry.loadEventEnd - navigationEntry.startTime);
    } else if (performance.timing) {
      const timing = performance.timing;
      domContentLoadedMs =
        timing.domContentLoadedEventEnd && timing.navigationStart
          ? timing.domContentLoadedEventEnd - timing.navigationStart
          : null;
      loadMs =
        timing.loadEventEnd && timing.navigationStart
          ? timing.loadEventEnd - timing.navigationStart
          : null;
    }

    return {
      scriptCount: document.scripts.length,
      stylesheetCount:
        document.querySelectorAll('link[rel="stylesheet"], style').length,
      domNodeCount: document.getElementsByTagName("*").length,
      domContentLoadedMs,
      loadMs,
      consoleErrorsAccessible: false,
      consoleErrorCount: null
    };
  }

  function getMobileSignals(interactiveElements, typographySignals) {
    const viewportWidth = window.innerWidth;
    const docWidth = document.documentElement.scrollWidth;
    const visibleButtons = interactiveElements.filter((item) => item.top < window.innerHeight * 1.2);
    const closeButtons = [];

    for (let index = 0; index < visibleButtons.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < visibleButtons.length; compareIndex += 1) {
        const first = visibleButtons[index];
        const second = visibleButtons[compareIndex];
        const horizontalGap =
          first.right < second.left
            ? second.left - first.right
            : second.right < first.left
              ? first.left - second.right
              : 0;
        const verticalGap =
          first.bottom < second.top
            ? second.top - first.bottom
            : second.bottom < first.top
              ? first.top - second.bottom
              : 0;

        if (horizontalGap < 8 && verticalGap < 12) {
          closeButtons.push([first.text, second.text]);
        }
        if (closeButtons.length >= 8) {
          break;
        }
      }
      if (closeButtons.length >= 8) {
        break;
      }
    }

    const elementsExceedingViewport = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > viewportWidth + 4;
      })
      .slice(0, 12);

    const fixedWidthContainers = Array.from(document.querySelectorAll("div, section, article, main"))
      .filter(isVisible)
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const width = Number.parseFloat(style.width) || 0;
        const minWidth = Number.parseFloat(style.minWidth) || 0;
        return width > viewportWidth + 4 || minWidth > viewportWidth + 4;
      })
      .slice(0, 12);

    return {
      viewportWidth,
      documentWidth: docWidth,
      hasHorizontalOverflowRisk: docWidth > viewportWidth + 4,
      smallTouchTargetCount: visibleButtons.filter((button) => button.width < 44 || button.height < 44)
        .length,
      buttonsTooCloseCount: closeButtons.length,
      smallMobileTextRisk:
        typographySignals.averageBodyFontSize > 0 &&
        typographySignals.averageBodyFontSize < 15.5,
      elementsExceedingViewportCount: elementsExceedingViewport.length,
      fixedWidthContainerCount: fixedWidthContainers.length
    };
  }

  function getLinkSignals() {
    const origin = window.location.origin;
    const internalLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        try {
          return new URL(anchor.getAttribute("href"), window.location.href);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .filter((url) => url.origin === origin)
      .filter((url) => !url.hash || url.pathname !== window.location.pathname)
      .map((url) => url.href.split("#")[0]);

    return {
      totalInternalLinks: new Set(internalLinks).size,
      sampleInternalLinks: Array.from(new Set(internalLinks)).slice(0, 25)
    };
  }

  function getMetadata() {
    const title = document.title || "";
    const metaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const viewport =
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
    const canonical =
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
    const lang = document.documentElement.getAttribute("lang") || "";
    const ogTags = document.querySelectorAll('meta[property^="og:"]').length;

    return {
      url: window.location.href,
      origin: window.location.origin,
      title: normalizeWhitespace(title),
      metaDescription: normalizeWhitespace(metaDescription),
      lang: normalizeWhitespace(lang),
      viewportMeta: Boolean(viewport),
      viewportContent: viewport,
      canonical,
      openGraphTagCount: ogTags
    };
  }

  function buildSnapshot() {
    if (!document.documentElement || !document.body) {
      throw new Error("This page does not expose a readable DOM.");
    }

    const bodyText = normalizeWhitespace(document.body.innerText || "").slice(0, 150000);
    const metadata = getMetadata();
    const headingSignals = getHeadingSignals();
    const typographySignals = getTypographySignals();
    const interactiveElements = collectInteractiveElements();
    const heroSignals = analyzeHeroSection(window.innerHeight);
    const contactSignals = getContactSignals(bodyText);
    const trustSignals = getTrustSignals(bodyText);
    const imageSignals = getImageSignals();
    const formSignals = getFormSignals();
    const technicalSignals = getTechnicalSignals();
    const mobileSignals = getMobileSignals(interactiveElements, typographySignals);
    const linkSignals = getLinkSignals();

    const ctaElementsAboveFold = interactiveElements.filter(
      (item) => item.bottom > 0 && item.top < window.innerHeight * 0.92 && matchesCta(item.text)
    );

    const interactiveAboveFoldCount = interactiveElements.filter(
      (item) => item.bottom > 0 && item.top < window.innerHeight
    ).length;

    return {
      pageInfo: {
        ...metadata,
        analysisTimestamp: new Date().toISOString()
      },
      rawSignals: {
        headings: headingSignals,
        hero: heroSignals,
        typography: typographySignals,
        cta: {
          matchesAboveFold: ctaElementsAboveFold.length,
          hasPrimaryCtaAboveFold: ctaElementsAboveFold.length > 0,
          interactiveAboveFoldCount
        },
        contact: contactSignals,
        trust: trustSignals,
        images: imageSignals,
        forms: formSignals,
        technical: technicalSignals,
        mobile: mobileSignals,
        links: linkSignals,
        bodyTextSampleLength: bodyText.length
      }
    };
  }

  window.__BROKEN_WEBSITE_DETECTOR_ANALYZE__ = function analyzePageForExtension() {
    try {
      return { ok: true, data: buildSnapshot() };
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : "page_analysis_failed"
      };
    }
  };
})();
