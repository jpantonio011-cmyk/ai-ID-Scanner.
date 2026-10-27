// script.js
(function() {
  // ---------- DOM elements ----------
  const fileInput = document.getElementById('fileInput');
  const previewContainer = document.getElementById('previewContainer');
  const scanBtn = document.getElementById('scanBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const statusMsg = document.getElementById('statusMsg');
  const resultCard = document.getElementById('resultCard');
  const responseText = document.getElementById('responseText');
  const dropZone = document.getElementById('dropZone');

  // ---------- state ----------
  let currentFile = null;
  let currentPreviewUrl = null;
  let abortController = null;
  let isRequesting = false;

  // ---------- constants ----------
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const ENDPOINT = 'https://oxford.uk.eu.org/ai/oxford';

  // ---------- helpers ----------
  function setStatus(text, isError = false) {
    statusMsg.innerHTML = '';
    if (text) {
      if (isError) {
        statusMsg.innerHTML = `<span class="error-text" style="background:transparent;padding:0;">⚠️ ${escapeHtml(text)}</span>`;
      } else {
        statusMsg.textContent = text;
      }
    }
  }

  function setLoadingUI(loading, message = '') {
    isRequesting = loading;
    if (loading) {
      statusMsg.innerHTML = `<span class="spinner"></span> ${escapeHtml(message || 'Scanning ID…')}`;
      scanBtn.disabled = true;
      cancelBtn.disabled = false;
    } else {
      if (statusMsg.querySelector('.spinner')) {
        statusMsg.innerHTML = '';
      }
      scanBtn.disabled = !currentFile;
      cancelBtn.disabled = true;
    }
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clearResult() {
    resultCard.style.display = 'none';
    responseText.textContent = '';
  }

  function showError(message) {
    resultCard.style.display = 'block';
    responseText.innerHTML = `<div class="error-text">${escapeHtml(message)}</div>`;
  }

  // ---------- image handling ----------
  function revokePreview() {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }
  }

  function handleFile(file) {
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setStatus('❌ Only JPEG, PNG, GIF, or WebP images are allowed.', true);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setStatus('❌ Image too large (max 5 MB).', true);
      return;
    }

    revokePreview();
    currentFile = file;
    currentPreviewUrl = URL.createObjectURL(file);

    previewContainer.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'preview-thumb';
    img.src = currentPreviewUrl;
    img.alt = 'ID preview';
    previewContainer.appendChild(img);

    if (!isRequesting) scanBtn.disabled = false;
    setStatus('');
    clearResult();
  }

  function resetFileInput() {
    fileInput.value = '';
    revokePreview();
    currentFile = null;
    previewContainer.innerHTML = '🖼️';
    previewContainer.className = 'preview-placeholder';
    scanBtn.disabled = true;
    setStatus('');
    clearResult();
    if (isRequesting) cancelRequest();
  }

  // ---------- cancel ----------
  function cancelRequest() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    setLoadingUI(false);
    setStatus('Request cancelled.', false);
    scanBtn.disabled = !currentFile;
    cancelBtn.disabled = true;
  }

  // ---------- resize to jpeg ----------
  async function resizeImage(file, maxSide = 1280, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error('Canvas conversion failed'));
          else resolve(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not load image'));
      };
      img.src = url;
    });
  }

  // ---------- prompt ----------
  function buildPrompt() {
    return `You are an ID scanner. Analyze the uploaded student ID photo and extract the student information.

Reply with ONLY a valid JSON object, no markdown, no code fences. Use exactly this structure:
{
  "name": "full name of the student",
  "course": "course/program (e.g., BS Computer Science)",
  "year": "year level (e.g., 1st Year, 2nd Year)",
  "section": "section (e.g., A, B, Section 1)"
}

Rules:
- If a field cannot be read or is not present, use "Not found".
- Do not include any other text outside the JSON.
- Read carefully from the ID card. Use the exact text shown on the card.`;
  }

  // ---------- extract json ----------
  function extractJson(text) {
    const t = String(text).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      return null;
    }
  }

  // ---------- render result ----------
  function renderResult(apiReply) {
    const parsed = extractJson(apiReply);

    const expected = ['name', 'course', 'year', 'section'];
    const isValid = parsed && typeof parsed === 'object' &&
      expected.every(f => typeof parsed[f] === 'string');

    if (isValid) {
      responseText.innerHTML = '';

      const grid = document.createElement('div');
      grid.className = 'info-grid';

      const fields = [
        { key: 'name', label: '👤 Name' },
        { key: 'course', label: '📚 Course' },
        { key: 'year', label: '📅 Year' },
        { key: 'section', label: '🔢 Section' }
      ];

      fields.forEach(({ key, label }) => {
        const item = document.createElement('div');
        item.className = 'info-item';

        const labelEl = document.createElement('div');
        labelEl.className = 'info-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('div');
        valueEl.className = 'info-value';
        valueEl.textContent = parsed[key] || 'Not found';

        item.appendChild(labelEl);
        item.appendChild(valueEl);
        grid.appendChild(item);
      });

      responseText.appendChild(grid);
    } else {
      responseText.textContent = apiReply;
    }

    resultCard.style.display = 'block';
  }

  // ---------- main scan ----------
  async function scanID() {
    if (!currentFile) {
      setStatus('Please select an ID image first.', true);
      return;
    }
    if (isRequesting) return;

    clearResult();
    setStatus('');

    let uploadBlob;
    try {
      setLoadingUI(true, 'Preparing image…');
      uploadBlob = await resizeImage(currentFile, 1280, 0.85);
    } catch (err) {
      setLoadingUI(false);
      setStatus('❌ Could not process image. Try another photo.', true);
      return;
    }

    const form = new FormData();
    form.append('message', buildPrompt());
    form.append('image', uploadBlob, 'id.jpg');

    abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      if (abortController) abortController.abort();
    }, 75000);

    setLoadingUI(true, 'Scanning ID… this may take up to 30s');

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body: form,
        signal: abortController.signal
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = data.error || `Request failed (HTTP ${res.status})`;
        if (res.status === 403) {
          throw new Error('Available only in the Philippines.');
        } else if (res.status === 413) {
          throw new Error('Image too large. Please use a smaller image.');
        } else if (res.status === 429) {
          const retry = res.headers.get('Retry-After') || 'a minute';
          throw new Error(`Too many requests. Wait ${retry}.`);
        } else if (res.status === 502 || res.status === 503) {
          throw new Error('AI temporarily unavailable. Try again shortly.');
        } else {
          throw new Error(errorMsg);
        }
      }

      if (!data.reply) {
        throw new Error('No reply from AI.');
      }

      renderResult(data.reply);
      setStatus('Scan complete ✅');
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatus('Request timed out or cancelled.', true);
      } else {
        setStatus(err.message || 'Network error. Please try again.', true);
      }
      showError(err.message || 'Network error.');
    } finally {
      clearTimeout(timeoutId);
      abortController = null;
      setLoadingUI(false);
      if (currentFile) scanBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  }

  // ---------- events ----------
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    else if (!currentFile) resetFileInput();
  });

  scanBtn.addEventListener('click', scanID);

  cancelBtn.addEventListener('click', () => {
    if (isRequesting) cancelRequest();
  });

  // drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // init
  scanBtn.disabled = true;
  cancelBtn.disabled = true;

  window.addEventListener('beforeunload', revokePreview);
})();