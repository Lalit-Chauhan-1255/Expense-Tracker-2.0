(function () {
  function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const toggles = document.querySelectorAll('.password-toggle');
  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword ? "<i class='bx bx-show'></i>" : "<i class='bx bx-hide'></i>";
    });
  });

  const openModalButtons = document.querySelectorAll('[data-open-modal]');
  const closeModalButtons = document.querySelectorAll('[data-close-modal]');
  const overlays = document.querySelectorAll('.modal-overlay');

  function closeAllModals() {
    overlays.forEach(function (overlay) {
      overlay.setAttribute('aria-hidden', 'true');
    });
  }

  openModalButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const id = btn.getAttribute('data-open-modal');
      const modal = document.getElementById(id);
      if (!modal) return;
      modal.setAttribute('aria-hidden', 'false');

      const dateInput = modal.querySelector('[data-date-input]');
      if (dateInput && !dateInput.value) {
        dateInput.value = todayString();
      }
    });
  });

  closeModalButtons.forEach(function (btn) {
    btn.addEventListener('click', closeAllModals);
  });

  overlays.forEach(function (overlay) {
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        closeAllModals();
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeAllModals();
    }
  });

  const forms = document.querySelectorAll('.modal-form');
  forms.forEach(function (form) {
    const hiddenIcon = form.querySelector('[data-icon-target]');
    const preview = form.querySelector('[data-icon-preview]');
    const togglesInForm = form.querySelectorAll('[data-icon-toggle]');

    togglesInForm.forEach(function (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        const panelId = toggleBtn.getAttribute('data-icon-toggle');
        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.hidden = !panel.hidden;
      });
    });

    form.querySelectorAll('[data-emoji]').forEach(function (emojiBtn) {
      emojiBtn.addEventListener('click', function () {
        const emoji = emojiBtn.getAttribute('data-emoji');
        if (!emoji) return;

        if (hiddenIcon) hiddenIcon.value = emoji;
        if (preview) preview.textContent = emoji;

        const picker = emojiBtn.closest('.icon-picker');
        if (picker) picker.hidden = true;
      });
    });

    const searchInput = form.querySelector('[data-icon-search]');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const term = searchInput.value.trim().toLowerCase();
        form.querySelectorAll('[data-emoji]').forEach(function (emojiBtn) {
          const emoji = (emojiBtn.getAttribute('data-emoji') || '').toLowerCase();
          emojiBtn.hidden = term ? !emoji.includes(term) : false;
        });
      });
    }

    function setFieldError(name, message) {
      const errorEl = form.querySelector(`[data-error-for='${name}']`);
      if (errorEl) {
        errorEl.textContent = message || '';
      }
    }

    ['title', 'category', 'amount', 'date'].forEach(function (fieldName) {
      const field = form.querySelector(`[name='${fieldName}']`);
      if (field) {
        field.addEventListener('input', function () {
          setFieldError(fieldName, '');
        });
        field.addEventListener('change', function () {
          setFieldError(fieldName, '');
        });
      }
    });

    form.addEventListener('submit', function (event) {
      let hasError = false;
      const titleField = form.querySelector("[name='title']");
      const categoryField = form.querySelector("[name='category']");
      const amountField = form.querySelector("[name='amount']");
      const dateField = form.querySelector("[name='date']");

      const title = titleField ? titleField.value.trim() : '';
      const category = categoryField ? categoryField.value.trim() : '';
      const amount = amountField ? Number(amountField.value) : NaN;
      const date = dateField ? dateField.value : '';

      if (!title) {
        setFieldError('title', 'Title is required.');
        hasError = true;
      }
      if (!category) {
        setFieldError('category', 'Category is required.');
        hasError = true;
      }
      if (Number.isNaN(amount) || amount <= 0) {
        setFieldError('amount', 'Enter an amount greater than 0.');
        hasError = true;
      }
      if (!date) {
        setFieldError('date', 'Date is required.');
        hasError = true;
      }

      if (hasError) {
        event.preventDefault();
      }
    });
  });

  function bindEditButtons(selector, modalId, formSelectorPrefix, actionPrefix) {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        const modal = document.getElementById(modalId);
        const form = document.querySelector(`[data-edit-form='${formSelectorPrefix}']`);
        if (!modal || !form) return;

        const id = button.getAttribute('data-id') || '0';
        const title = button.getAttribute('data-title') || '';
        const date = button.getAttribute('data-date') || todayString();
        const amount = button.getAttribute('data-amount') || '';
        const icon = button.getAttribute('data-icon') || '';

        form.action = `${actionPrefix}/${id}`;

        const titleInput = form.querySelector("input[name='title']");
        const categoryInput = form.querySelector("select[name='category']");
        const amountInput = form.querySelector("input[name='amount']");
        const dateInput = form.querySelector("input[name='date']");
        const iconInput = form.querySelector('[data-icon-target]');
        const preview = form.querySelector('[data-icon-preview]');
        const category = button.getAttribute('data-category') || '';

        if (titleInput) titleInput.value = title;
        if (categoryInput) categoryInput.value = category;
        if (amountInput) amountInput.value = amount;
        if (dateInput) dateInput.value = date;
        if (iconInput) iconInput.value = icon;
        if (preview) preview.textContent = icon;

        modal.setAttribute('aria-hidden', 'false');
      });
    });
  }

  bindEditButtons('[data-edit-income]', 'incomeEditModal', 'income', '/income/edit');
  bindEditButtons('[data-edit-expense]', 'expenseEditModal', 'expense', '/expense/edit');

  function bindPasswordValidation(config) {
    const form = document.querySelector(config.formSelector);
    if (!form) return;

    const passwordInput = form.querySelector(config.passwordSelector);
    const confirmInput = form.querySelector(config.confirmSelector);
    const errorEl = form.querySelector("[data-error-for='confirmPassword']");

    if (!passwordInput || !confirmInput || !errorEl) return;

    function setError(message) {
      errorEl.textContent = message || '';
    }

    function validateMatch() {
      const passwordValue = passwordInput.value || '';
      const confirmValue = confirmInput.value || '';

      if (!confirmValue) {
        setError('');
        return true;
      }

      if (passwordValue !== confirmValue) {
        setError(config.mismatchMessage);
        return false;
      }

      setError('');
      return true;
    }

    passwordInput.addEventListener('input', validateMatch);
    confirmInput.addEventListener('input', validateMatch);

    form.addEventListener('submit', function (event) {
      const valid = validateMatch();
      if (!valid) {
        event.preventDefault();
      }
    });
  }

  bindPasswordValidation({
    formSelector: "form[data-password-validate='signup']",
    passwordSelector: "input[name='password']",
    confirmSelector: "input[name='confirmPassword']",
    mismatchMessage: 'Password and confirm password must match.'
  });

  bindPasswordValidation({
    formSelector: "form[data-password-validate='settings']",
    passwordSelector: "input[name='newPassword']",
    confirmSelector: "input[name='confirmPassword']",
    mismatchMessage: 'New password and confirm password must match.'
  });

  const toast = document.querySelector('[data-auto-toast]');
  if (toast) {
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        toast.remove();
      }, 180);
    }, 2400);
  }
})();
