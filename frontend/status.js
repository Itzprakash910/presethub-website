(() => {
  const q = new URLSearchParams(location.search);
  const error = q.get('error');
  const target = document.getElementById('statusText');
  const ref = document.getElementById('ref');
  if (error && target) target.textContent = `PresetHub reported a temporary service error (${error}). Please try again shortly.`;
  if (ref) ref.textContent = `PH-${Date.now().toString(36).toUpperCase()}`;
})();
