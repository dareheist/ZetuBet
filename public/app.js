(() => {
  // ============================================================
  // 1. GENERAL HELPERS AND API CONNECTION
  // ============================================================

  const $ = (id) => document.getElementById(id);

  const money = (n) =>
    'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');

  let currentUser = null;

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }

    return data;
  };


  // ============================================================
  // 2. NOTIFICATIONS AND MESSAGES
  // ============================================================

  function authMessage(message, success = false) {
    $('auth-message').textContent = message || '';
    $('auth-message').classList.toggle('success', success);
  }

  function notice(title, message) {
    $('notice-title').textContent = title;
    $('notice').textContent = message;
    const box = document.querySelector('.notice');
    if (box) box.hidden = false;
  }


  // ============================================================
  // 3. LOGIN AND REGISTRATION DISPLAY
  // ============================================================

  function showLogin() {
    $('login-panel').hidden = false;
    $('register-panel').hidden = true;

    $('show-login').classList.add('active');
    $('show-register').classList.remove('active');

    authMessage('');
  }

  function showRegister() {
    $('login-panel').hidden = true;
    $('register-panel').hidden = false;

    $('show-register').classList.add('active');
    $('show-login').classList.remove('active');

    authMessage('');
  }


  // ============================================================
  // 4. ACCOUNT DETAILS AND BALANCES
  // ============================================================

  function renderUser(user) {
    currentUser = user;

    $('auth-view').hidden = !!user;
    $('dashboard-view').hidden = !user;
    $('logout-button').hidden = !user;

    if (!user) return;

    $('savings').textContent = money(user.savingsBalance);
    $('savings-page-balance').textContent = money(user.savingsBalance);

    $('loan-page-balance').textContent =
      money(user.loanWalletBalance);

    $('loan-page-repayable').textContent =
      money(user.outstandingDebt);

    $('loan-page-status').textContent =
      user.outstandingDebt > 0 ? 'Repayment due' : 'No active loan';

    $('loan-wallet').textContent = money(user.loanWalletBalance);
    $('loan-limit').textContent = money(user.loanLimit);
    $('limit-inline').textContent = money(user.loanLimit);
    $('outstanding').textContent = money(user.outstandingDebt);

    $('loan-status').textContent =
      user.outstandingDebt > 0
        ? 'Repay in full before a new loan'
        : 'No active loan recorded';

    $('apply-button').disabled = user.outstandingDebt > 0;

    const profileName = $('profile-name');
    const profileEmail = $('profile-email');
    const profilePhone = $('profile-phone');
    if (profileName) profileName.textContent = user.fullName || '—';
    if (profileEmail) profileEmail.textContent = user.email || '—';
    if (profilePhone) profilePhone.textContent = user.phone || '—';
    if ($('menu-open')) $('menu-open').hidden = !user;
  }


  // ============================================================
  // 5. LOAN CALCULATIONS
  // ============================================================

  const days = (n) =>
    n <= 500 ? 14 :
    n <= 1500 ? 21 :
    n <= 5000 ? 30 :
    n <= 10000 ? 45 : 60;

  function quote() {
    const n = Math.max(0, Number($('principal').value) || 0);
    const charge = Math.round(n * (20 / 150));

    $('quote-principal').textContent = money(n);
    $('quote-charge').textContent = money(charge);
    $('quote-total').textContent = money(n + charge);
    $('quote-days').textContent = days(n) + ' days';
  }


  // ============================================================
  // 6. LOAN APPLICATION AND VERIFICATION
  // ============================================================

  async function showLoan() {
    $('dashboard-view').hidden = true;
    $('loan-view').hidden = false;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    $('kyc-panel').hidden = false;
    $('loan-amount-panel').hidden = true;
    $('kyc-form').hidden = false;

    $('kyc-full-name').value = currentUser?.fullName || '';
    $('kyc-status').textContent = 'Checking your verification status…';

    try {
      const data = await api('/api/loan/application-status');

      if (data.status === 'verified') {
        $('kyc-panel').hidden = true;
        $('loan-amount-panel').hidden = false;
        quote();

      } else if (data.status === 'pending') {
        $('kyc-status').textContent =
          'Application submitted successfully. Status: PENDING. Your documents are awaiting admin review.';

        $('kyc-form').hidden = true;

      } else {
        $('kyc-form').hidden = false;

        $('kyc-status').textContent =
          data.status === 'rejected'
            ? `Your last application was not approved. ${data.reviewNote || 'Please check your details and submit again.'}`
            : 'Complete the form below. Your application will be pending until a reviewer checks it.';
      }

    } catch (error) {
      $('kyc-status').textContent = error.message;
    }
  }


  // ============================================================
  // 7. DASHBOARD AND WALLET NAVIGATION
  // ============================================================

  function hideAccountPages() {
    ['loan-view', 'savings-view', 'loan-wallet-view', 'profile-view', 'loan-info-view', 'history-view', 'help-view'].forEach((id) => {
      $(id).hidden = true;
    });
  }

  function showDashboard() {
    hideAccountPages();

    $('dashboard-view').hidden = false;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showSavingsWallet() {
    if ($('menu-overlay')) $('menu-overlay').hidden = true;
    history.replaceState({ zetuPage: 'savings-view' }, '', '#savings');
    $('dashboard-view').hidden = true;

    hideAccountPages();

    $('savings-view').hidden = false;

    $('savings-page-balance').textContent =
      money(currentUser?.savingsBalance);

    $('savings-payment-note').textContent =
      'Enter an amount to continue. Your payment must be confirmed before your savings balance changes.';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showLoanWallet() {
    if ($('menu-overlay')) $('menu-overlay').hidden = true;
    history.replaceState({ zetuPage: 'loan-wallet-view' }, '', '#loan-wallet');
    $('dashboard-view').hidden = true;

    hideAccountPages();

    $('loan-wallet-view').hidden = false;

    $('loan-page-balance').textContent =
      money(currentUser?.loanWalletBalance);

    $('loan-page-repayable').textContent =
      money(currentUser?.outstandingDebt);

    $('loan-page-status').textContent =
      currentUser?.outstandingDebt > 0
        ? 'Repayment due'
        : 'No active loan';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openWalletFromKeyboard(event, callback) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  }


  // ============================================================
  // 8. LOGIN
  // ============================================================

  $('show-login').addEventListener('click', showLogin);
  $('show-register').addEventListener('click', showRegister);

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    authMessage('Logging in…');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('login-email').value,
          password: $('login-password').value
        })
      });

      renderUser(data.user);

      notice('Successfully logged in', 'Welcome back.');

    } catch (error) {
      authMessage(error.message);
    }
  });


  // ============================================================
  // 9. REGISTRATION
  // ============================================================

  $('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    if ($('register-password').value !== $('register-confirm').value) {
      return authMessage('The passwords do not match.');
    }

    authMessage('Creating your account…');

    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: $('register-name').value,
          nationalId: $('register-id').value,
          email: $('register-email').value,
          phone: $('register-phone').value,
          password: $('register-password').value
        })
      });

      renderUser(data.user);

      notice('Successfully registered', 'Your account has been created.');

    } catch (error) {
      authMessage(error.message);
    }
  });


  // ============================================================
  // 10. LOGOUT
  // ============================================================

  $('logout-button').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        body: '{}'
      });
    } catch (_) {}

    renderUser(null);
    showLogin();

    notice('Successfully logged out', 'You have been logged out.');
  });


  // ============================================================
  // 11. WALLET BUTTONS AND NAVIGATION
  // ============================================================

  $('open-loan-button').addEventListener('click', showLoan);

  $('back-dashboard').addEventListener('click', showDashboard);
  $('back-from-savings').addEventListener('click', showDashboard);
  $('back-from-loan-wallet').addEventListener('click', showDashboard);

  $('open-savings-wallet').addEventListener('click', (event) => {
    event.stopPropagation();
    showSavingsWallet();
  });

  $('open-loan-wallet').addEventListener('click', (event) => {
    event.stopPropagation();
    showLoanWallet();
  });

  $('savings-wallet-card').addEventListener('click', (event) => {
    if (!event.target.closest('button')) {
      showSavingsWallet();
    }
  });

  $('loan-wallet-card').addEventListener('click', (event) => {
    if (!event.target.closest('button')) {
      showLoanWallet();
    }
  });

  $('savings-wallet-card').addEventListener('keydown', (event) => {
    openWalletFromKeyboard(event, showSavingsWallet);
  });

  $('loan-wallet-card').addEventListener('keydown', (event) => {
    openWalletFromKeyboard(event, showLoanWallet);
  });


  // ============================================================
  // 12. DEPOSIT TO SAVINGS WALLET — DIRECT ZETUPAY STK PUSH
  // The customer stays on ZetuCash. No checkout redirect is used.
  // ============================================================

  async function waitForDepositResult(reference, button) {
    const maxChecks = 24;

    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let data;
      try {
        data = await api(`/api/payments/deposit/${encodeURIComponent(reference)}/status`);
      } catch (error) {
        $('savings-payment-note').textContent =
          `The prompt was sent. Checking payment status… ${error.message}`;
        continue;
      }

      if (data.status === 'success') {
        try {
          const account = await api('/api/auth/me');
          renderUser(account.user);
        } catch (_) {}

        $('savings-page-balance').textContent = money(currentUser?.savingsBalance);
        $('savings-payment-note').textContent =
          `Payment confirmed. ${money(data.amount)} has been added to your savings wallet.`;
        notice('Successful deposit', `${money(data.amount)} has been added to your savings wallet.`);
        return;
      }

      if (['failed', 'cancelled', 'expired'].includes(data.status)) {
        $('savings-payment-note').textContent =
          data.status === 'cancelled'
            ? 'The M-Pesa prompt was cancelled. Your savings balance has not changed. You can try again.'
            : data.status === 'expired'
              ? 'The M-Pesa prompt expired. Your savings balance has not changed. Please try again.'
              : 'The payment failed. Your savings balance has not changed. Please try again.';
        return;
      }

      $('savings-payment-note').textContent =
        'STK Push sent. Check your phone and enter your M-Pesa PIN. Waiting for payment confirmation…';
    }

    $('savings-payment-note').textContent =
      'We have not received final confirmation yet. Do not pay again immediately. Check your M-Pesa messages or refresh the wallet shortly.';
  }

  $('savings-deposit-continue').addEventListener('click', async () => {
    const amount = Number($('deposit-amount').value);

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000) {
      $('savings-payment-note').textContent =
        'Enter a whole-KSh amount from KSh 1 to KSh 250,000.';

      $('deposit-amount').focus();
      return;
    }

    const button = $('savings-deposit-continue');
    button.disabled = true;
    button.textContent = 'Sending M-Pesa prompt…';
    $('savings-payment-note').textContent =
      'Requesting an M-Pesa STK Push through ZetuPay. Please wait…';

    try {
      const data = await api('/api/payments/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount })
      });

      if (!data.reference || !data.paymentKey) {
        throw new Error('The payment provider did not confirm the STK Push request. Please try again later.');
      }

      $('savings-payment-note').textContent =
        'STK Push sent. Check your phone and enter your M-Pesa PIN. Your balance will update only after payment is confirmed.';

      // Keep the user on ZetuCash and check the provider's verified status.
      await waitForDepositResult(data.reference, button);

    } catch (error) {
      $('savings-payment-note').textContent = error.message;

    } finally {
      button.disabled = false;
      button.textContent = 'Continue to deposit';
    }
  });


  // ============================================================
  // 13-14. SAVINGS AND LOAN WALLET WITHDRAWALS
  function openWithdrawalForm(wallet) {
    const id = wallet === 'loan' ? 'loan-withdraw-form' : 'savings-withdraw-form';
    const form = $(id);
    if (form) {
      form.hidden = false;
      const input = form.querySelector('input[name="amount"]');
      if (input) input.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  $('savings-withdraw-entry').addEventListener('click', () => openWithdrawalForm('savings'));
  $('withdraw-savings').addEventListener('click', () => { showSavingsWallet(); openWithdrawalForm('savings'); });
  $('loan-wallet-withdraw-entry').addEventListener('click', () => openWithdrawalForm('loan'));
  $('withdraw-loan').addEventListener('click', () => { showLoanWallet(); openWithdrawalForm('loan'); });

  async function submitWithdrawal(event, wallet) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('input[name="amount"]');
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[aria-live="polite"]');
    const amount = Number(input.value);
    if (!Number.isInteger(amount) || amount <= 0) {
      status.textContent = 'Enter a valid whole-KSh amount greater than zero.';
      return;
    }
    const balance = wallet === 'loan' ? Number(currentUser?.loanWalletBalance || 0) : Number(currentUser?.savingsBalance || 0);
    if (amount > balance) { status.textContent = 'Insufficient funds in this wallet.'; return; }
    button.disabled = true; button.textContent = 'Processing…'; status.textContent = 'Submitting withdrawal request…';
    try {
      const data = await api('/api/payments/withdraw', { method: 'POST', body: JSON.stringify({ amount, wallet }) });
      const fresh = await api('/api/auth/me');
      renderUser(fresh.user);
      $('savings-page-balance').textContent = money(fresh.user.savingsBalance);
      $('loan-page-balance').textContent = money(fresh.user.loanWalletBalance);
      const state = String(data.status || 'processing').toLowerCase();
      if (['success','successful','completed','paid'].includes(state)) {
        notice('Successful withdrawal', `${money(amount)} has been withdrawn from your ${wallet === 'loan' ? 'Loan' : 'Savings'} Wallet.`);
        status.textContent = 'Successful withdrawal.';
      } else {
        notice('Withdrawal submitted', `Your ${money(amount)} withdrawal request is being processed. We will confirm when the payout is complete.`);
        status.textContent = 'Withdrawal submitted and awaiting payout confirmation.';
      }
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      notice('Withdrawal unsuccessful', error.message);
    } finally { button.disabled = false; button.textContent = 'Withdraw'; }
  }
  $('savings-withdraw-form').addEventListener('submit', (event) => submitWithdrawal(event, 'savings'));
  $('loan-withdraw-form').addEventListener('submit', (event) => submitWithdrawal(event, 'loan'));


  // ============================================================
  // 15. LOAN REPAYMENT
  // ============================================================

  $('repay-button').addEventListener('click', () => {
    notice(
      'Repayment information',
      'Repayment processing is not connected yet. Your outstanding balance has not changed.'
    );
  });


  // ============================================================
  // 16. LOAN QUOTE
  // ============================================================

  $('principal').addEventListener('input', quote);


  // ============================================================
  // 17. LOAN VERIFICATION DOCUMENTS
  // ============================================================

  $('kyc-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const files = ['id-front', 'id-back', 'id-selfie'];

    for (const id of files) {
      const file = $(id).files[0];

      if (!file) {
        return notice(
          'Missing document',
          'Please upload the front and back of your ID and a selfie.'
        );
      }

      if (file.size > 3 * 1024 * 1024) {
        return notice(
          'Image too large',
          'Each ID photo or selfie must be 3 MB or smaller.'
        );
      }
    }

    const button = $('submit-kyc');

    button.disabled = true;
    button.textContent = 'Submitting securely…';

    try {
      const formData = new FormData($('kyc-form'));

      formData.set(
        'nationalId',
        $('kyc-id-number').value.trim()
      );

      const response = await fetch('/api/loan/application', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || 'Could not submit your application.'
        );
      }

      $('kyc-form').hidden = true;

      $('kyc-status').textContent = 'Status: PENDING — your application was submitted successfully and is awaiting admin review.';

      notice('Application submitted successfully', 'Status: PENDING. Your application and documents have been sent for admin review.');

    } catch (error) {
      notice('Could not submit application', error.message);

    } finally {
      button.disabled = false;
      button.textContent = 'Submit for verification';
    }
  });


  // ============================================================
  // 18. LOAN REQUEST
  // ============================================================

  $('apply-button').addEventListener('click', async () => {
    const principal = Number($('principal').value);

    try {
      const data = await api('/api/loan/request', {
        method: 'POST',
        body: JSON.stringify({ principal })
      });

      notice(
        'Loan request submitted',
        `Your request for ${money(data.principal)} is pending review. Illustrative charge: ${money(data.charge)}; total repayment: ${money(data.total)} in ${data.days} days. No loan has been approved or disbursed.`
      );

      showDashboard();

    } catch (error) {
      notice('Loan quote unavailable', error.message);
    }
  });



  // ============================================================
  // 20. PROFILE, MENU DRAWER, DARK MODE AND MOBILE BACK BUTTON
  // ============================================================
  const accountPageIds = ['dashboard-view','loan-view','savings-view','loan-wallet-view','profile-view','loan-info-view','history-view','help-view'];
  function showPage(id, push=true) {
    accountPageIds.forEach((page) => { const el = $(page); if (el) el.hidden = page !== id; });
    if (id === 'home') { accountPageIds.forEach((page) => { if ($(page)) $(page).hidden = page !== 'dashboard-view'; }); id='dashboard-view'; }
    if (push) history.pushState({ zetuPage:id }, '', id === 'dashboard-view' ? '#home' : '#' + id.replace('-view',''));
    if ($('menu-overlay')) $('menu-overlay').hidden = true;
    window.scrollTo({top:0, behavior:'auto'});
  }
  if ($('menu-open')) $('menu-open').addEventListener('click', () => { $('menu-overlay').hidden = false; });
  if ($('menu-close')) $('menu-close').addEventListener('click', () => { $('menu-overlay').hidden = true; });
  if ($('menu-overlay')) $('menu-overlay').addEventListener('click', (e) => { if (e.target === $('menu-overlay')) $('menu-overlay').hidden = true; });
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => {
    const target=button.dataset.go;
    if (target === 'home') { showDashboard(); history.pushState({zetuPage:'dashboard-view'}, '', '#home'); }
    else if (target === 'savings-view') showSavingsWallet();
    else if (target === 'loan-wallet-view') showLoanWallet();
    else if (target === 'loan-info-view') showPage(target);
    else showPage(target);
  }));
  if ($('open-savings-wallet')) $('open-savings-wallet').addEventListener('click', showSavingsWallet);
  if ($('open-loan-wallet')) $('open-loan-wallet').addEventListener('click', showLoanWallet);
  if ($('open-loan-from-info')) $('open-loan-from-info').addEventListener('click', showLoan);
  if ($('dark-mode-toggle')) {
    $('dark-mode-toggle').checked = localStorage.getItem('zetucash-dark-mode') === '1';
    document.body.classList.toggle('dark-mode', $('dark-mode-toggle').checked);
    $('dark-mode-toggle').addEventListener('change', () => {
      document.body.classList.toggle('dark-mode', $('dark-mode-toggle').checked);
      localStorage.setItem('zetucash-dark-mode', $('dark-mode-toggle').checked ? '1' : '0');
    });
  }
  if ($('menu-logout')) $('menu-logout').addEventListener('click', () => $('logout-button').click());
  window.addEventListener('popstate', () => {
    const hash = location.hash.slice(1);
    if (hash === 'savings') showSavingsWallet();
    else if (hash === 'loan-wallet') showLoanWallet();
    else if (hash === 'profile') showPage('profile-view', false);
    else if (hash === 'loan-info') showPage('loan-info-view', false);
    else if (hash === 'history') showPage('history-view', false);
    else if (hash === 'help') showPage('help-view', false);
    else showDashboard();
  });
  // Keep the login panel hidden until session verification finishes to prevent a login flash.
  $('auth-view').hidden = true;
  $('dashboard-view').hidden = true;

  // ============================================================
  // 19. LOAD EXISTING LOGIN SESSION
  // ============================================================

  api('/api/auth/me')
    .then((data) => renderUser(data.user))
    .catch(() => renderUser(null));

})();
