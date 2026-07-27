// دلني - Main JavaScript

// File upload validation
document.addEventListener('DOMContentLoaded', function() {
  // Auto-dismiss alerts after 5 seconds
  setTimeout(() => {
    document.querySelectorAll('.alert-dismissible').forEach(el => {
      const bsAlert = bootstrap.Alert.getInstance(el);
      if (bsAlert) bsAlert.close();
    });
  }, 5000);

  // Price formatting
  document.querySelectorAll('.format-price').forEach(el => {
    const val = parseFloat(el.dataset.price);
    if (!isNaN(val)) {
      el.textContent = val.toFixed(2) + ' ريال';
    }
  });

  // File input preview
  document.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener('change', function() {
      const preview = document.getElementById('filePreview');
      if (!preview) return;
      if (this.files && this.files[0]) {
        const file = this.files[0];
        const sizeMB = (file.size / 1024 / 1024).toFixed(2);
        preview.innerHTML = `
          <div class="alert alert-info py-2 mb-0 mt-2">
            <i class="bi bi-paperclip"></i> ${file.name}
            <span class="text-muted">(${sizeMB} MB)</span>
          </div>
        `;
        if (file.size > 5 * 1024 * 1024) {
          preview.innerHTML = `
            <div class="alert alert-danger py-2 mb-0 mt-2">
              <i class="bi bi-exclamation-triangle"></i> الملف كبير جداً! (الحد الأقصى 5MB)
            </div>
          `;
          this.value = '';
        }
      }
    });
  });

  // Tooltip initialization
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el);
  });
});

// Payment handler - Stripe Checkout or simulated
async function handlePayment(e) {
  e.preventDefault();
  const btn = document.getElementById('payBtn');
  const text = document.getElementById('payText');
  const spinner = document.getElementById('paySpinner');
  const form = document.getElementById('paymentForm');

  // Get consultation ID from the URL
  const pathParts = window.location.pathname.split('/');
  const consultationId = pathParts[pathParts.length - 1];

  // Disable button
  btn.disabled = true;
  text.textContent = 'جارِ الاتصال ببوابة الدفع...';
  spinner.classList.remove('d-none');

  try {
    const response = await fetch(`/stripe/create-checkout/${consultationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.url) {
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } else if (data.simulate) {
      // Simulated payment fallback
      window.location.href = data.redirect;
    } else if (data.error) {
      alert(data.error);
      btn.disabled = false;
      text.textContent = 'تأكيد الدفع';
      spinner.classList.add('d-none');
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال بالخادم');
    btn.disabled = false;
    text.textContent = 'تأكيد الدفع';
    spinner.classList.add('d-none');
  }
}
function sendMessage(consultationId) {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  if (!message) return;

  input.disabled = true;

  fetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consultation_id: consultationId, message })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      input.value = '';
      appendMessage(data.message);
      scrollChat();
    } else {
      alert(data.error || 'حدث خطأ');
    }
  })
  .catch(() => alert('حدث خطأ في الإرسال'))
  .finally(() => { input.disabled = false; input.focus(); });
}

function appendMessage(msg) {
  const chat = document.getElementById('chatMessages');
  const isClient = msg.sender_role === 'client';
  const div = document.createElement('div');
  div.className = `message-bubble ${isClient ? 'message-client' : 'message-consultant'}`;
  div.innerHTML = `
    <div class="fw-bold small mb-1">${msg.sender_name}</div>
    <div>${escapeHtml(msg.message)}</div>
    <div class="message-time">${new Date(msg.created_at).toLocaleString('ar-SA')}</div>
  `;
  chat.appendChild(div);
}

function scrollChat() {
  const chat = document.getElementById('chatMessages');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Enter key to send
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    const sendBtn = document.getElementById('sendBtn');
    if (document.activeElement === document.getElementById('messageInput') && sendBtn) {
      e.preventDefault();
      sendBtn.click();
    }
  }
});
