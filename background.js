const LINK_CHECK_LIMIT = 25;
const FETCH_TIMEOUT_MS = 5000;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function fetchWithFallback(url) {
  try {
    return await withTimeout(
      fetch(url, {
        method: "HEAD",
        redirect: "follow",
        cache: "no-store",
        credentials: "omit"
      }),
      FETCH_TIMEOUT_MS
    );
  } catch (headError) {
    return withTimeout(
      fetch(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        credentials: "omit"
      }),
      FETCH_TIMEOUT_MS
    );
  }
}

async function validateInternalLinks(origin, links) {
  const safeLinks = Array.from(new Set(links || []))
    .slice(0, LINK_CHECK_LIMIT)
    .filter((href) => {
      try {
        return new URL(href).origin === origin;
      } catch (error) {
        return false;
      }
    });

  const results = await Promise.all(
    safeLinks.map(async (url) => {
      try {
        const response = await fetchWithFallback(url);
        const finalUrl = response.url || url;
        const status = response.status || 0;

        if (status === 0 || status === 401 || status === 403) {
          return {
            url,
            finalUrl,
            state: "unchecked",
            httpStatus: status,
            reason: "restricted_response"
          };
        }

        if (status >= 400) {
          return {
            url,
            finalUrl,
            state: "broken",
            httpStatus: status
          };
        }

        return {
          url,
          finalUrl,
          state: "valid",
          httpStatus: status
        };
      } catch (error) {
        return {
          url,
          state: "unchecked",
          reason: error && error.message ? error.message : "fetch_failed"
        };
      }
    })
  );

  const summary = results.reduce(
    (accumulator, item) => {
      accumulator[item.state] += 1;
      return accumulator;
    },
    { valid: 0, broken: 0, unchecked: 0 }
  );

  return {
    checkedCount: results.length,
    limit: LINK_CHECK_LIMIT,
    summary,
    results
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BWD_VALIDATE_LINKS") {
    return false;
  }

  validateInternalLinks(message.origin, message.links)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "link_validation_failed"
      })
    );

  return true;
});
