(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => 'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
  let currentUser = null;
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };
  function authMessage(message, success = false) {
    $('auth-message').textContent = message || '';
    $('auth-message').classList.toggle('success', success);
  }
  function notice(title, message) {
    $('notice-title').textContent = title;
    $('notice').textContent = message;
  }
  function showLogin() {
    $('login-panel').hidden = false; $('register-panel').hidden = true;
    $('show-login').classList.add('active'); $('show-register').classList.remove('active'); authMessage('');
  }
  function showRegister() {
    $('login-panel').hidden = true; $('register-panel').hidden = false;
    $('show-register').classList.add('active'); $('show-login').classList.remove('active'); authMessage('');
  }
  function renderUser(user) {
    currentUser = user;
    $('auth-view').hidden = !!user;
    $('dashboard-view').hidden = !user;
    $('logout-button').hidden = !user;
    if (!user) return;
    $('savings').textContent = money(user.savingsBalance);
    $('savings-page-balance').textContent = money(user.savingsBalance);
    $('loan-page-balance').textContent = money(user.loanWalletBalance);
    $('loan-page-repayable').textContent = money(user.outstandingDebt);
    $('loan-page-status').textContent = user.outstandingDebt > 0 ? 'Repayment due' : 'No active loan';
    $('loan-wallet').textContent = money(user.loanWalletBalance);
    $('loan-limit').textContent = money(user.loanLimit);
    $('limit-inline').textContent = money(user.loanLimit);
    $('outstanding').textContent = money(user.outstandingDebt);
    $('loan-status').textContent = user.outstandingDebt > 0 ? 'Repay in full before a new loan' : 'No active loan recorded';
    $('apply-button').disabled = user.outstandingDebt > 0;
    let strip = $('account-strip');
    if (!strip) {
      strip = document.createElement('div'); strip.id = 'account-strip'; strip.className = 'account-strip';
      $('dashboard-view').prepend(strip);
    }
    strip.textContent = `Welcome, ${user.fullName} · ${user.email || ''} · M-Pesa: ${user.phone}`;
    $('loan-wallet').textContent = money(user.loanWalletBalance);
  }
  const days = (n) => n <= 500 ? 14 : n <= 1500 ? 21 : n <= 5000 ? 30 : n <= 10000 ? 45 : 60;
  function quote() {
    const n = Math.max(0, Number($('principal').value) || 0);
    const charge = Math.round(n * (20 / 150));
    $('quote-principal').textContent = money(n);
    $('quote-charge').textContent = money(charge);
    $('quote-total').textContent = money(n + charge);
    $('quote-days').textContent = days(n) + ' days';
  }
  async function showLoan() {
    $('dashboard-view').hidden = true; $('loan-view').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    $('kyc-panel').hidden = false; $('loan-amount-panel').hidden = true; $('kyc-form').hidden = false;
    $('kyc-full-name').value = currentUser?.fullName || '';
    $('kyc-status').textContent = 'Checking your verification status…';
    try {
      const data = await api('/api/loan/application-status');
      if (data.status === 'verified') {
        $('kyc-panel').hidden = true; $('loan-amount-panel').hidden = false; quote();
      } else if (data.status === 'pending') {
        $('kyc-status').textContent = 'Your documents are awaiting review. You cannot request a loan until an authorised reviewer verifies them.';
        $('kyc-form').hidden = true;
      } else {
        $('kyc-form').hidden = false;
        $('kyc-status').textContent = data.status === 'rejected' ? `Your last application was not approved. ${data.reviewNote || 'Please check your details and submit again.'}` : 'Complete the form below. Your application will be pending until a reviewer checks it.';
      }
    } catch (error) { $('kyc-status').textContent = error.message; }
  }
  function hideAccountPages() {
    ['loan-view', 'savings-view', 'loan-wallet-view'].forEach(id => { $(id).hidden = true; });
  }
  function showDashboard() { hideAccountPages(); $('dashboard-view').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function showSavingsWallet() {
    $('dashboard-view').hidden = true; hideAccountPages(); $('savings-view').hidden = false;
    $('savings-page-balance').textContent = money(currentUser?.savingsBalance);
    $('savings-payment-note').textContent = 'Enter an amount to continue. Payment processing must be connected and verified before real deposits can be accepted.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showLoanWallet() {
    $('dashboard-view').hidden = true; hideAccountPages(); $('loan-wallet-view').hidden = false;
    $('loan-page-balance').textContent = money(currentUser?.loanWalletBalance);
    $('loan-page-repayable').textContent = money(currentUser?.outstandingDebt);
    $('loan-page-status').textContent = currentUser?.outstandingDebt > 0 ? 'Repayment due' : 'No active loan';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openWalletFromKeyboard(event, callback) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); }
  }

  $('show-login').addEventListener('click', showLogin);
  $('show-register').addEventListener('click', showRegister);
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); authMessage('Logging in…');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('login-email').value, password: $('login-password').value }) });
      renderUser(data.user); notice('Logged in successfully', 'Your account details have loaded from the database.');
    } catch (error) { authMessage(error.message); }
  });
  $('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('register-password').value !== $('register-confirm').value) return authMessage('The passwords do not match.');
    authMessage('Creating your account…');
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName: $('register-name').value, nationalId: $('register-id').value, email: $('register-email').value, phone: $('register-phone').value, password: $('register-password').value }) });
      renderUser(data.user); notice('Account created', 'Your M-Pesa number is saved to your account. Deposits and withdrawals will be enabled after payment integration is completed.');
    } catch (error) { authMessage(error.message); }
  });
  $('logout-button').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    renderUser(null); showLogin(); notice('Logged out', 'Log in again to view your account.');
  });
  $('open-loan-button').addEventListener('click', showLoan);
  $('back-dashboard').addEventListener('click', showDashboard);
  $('back-from-savings').addEventListener('click', showDashboard);
  $('back-from-loan-wallet').addEventListener('click', showDashboard);
  $('open-savings-wallet').addEventListener('click', (event) => { event.stopPropagation(); showSavingsWallet(); });
  $('open-loan-wallet').addEventListener('click', (event) => { event.stopPropagation(); showLoanWallet(); });
  $('savings-wallet-card').addEventListener('click', (event) => { if (!event.target.closest('button')) showSavingsWallet(); });
  $('loan-wallet-card').addEventListener('click', (event) => { if (!event.target.closest('button')) showLoanWallet(); });
  $('savings-wallet-card').addEventListener('keydown', (event) => openWalletFromKeyboard(event, showSavingsWallet));
  $('loan-wallet-card').addEventListener('keydown', (event) => openWalletFromKeyboard(event, showLoanWallet));
  $('savings-deposit-continue').addEventListener('click', () => {
    const amount = Number($('deposit-amount').value);
    if (!Number.isInteger(amount) || amount < 10) {
      $('savings-payment-note').textContent = 'Enter a whole KSh amount of at least 10.';
      $('deposit-amount').focus(); return;
    }
    $('savings-payment-note').textContent = 'Amount entered: ' + money(amount) + '. The live ZetuPay checkout endpoint still needs to be connected and tested before payment can proceed.';
  });
  $('savings-withdraw-entry').addEventListener('click', () => $('withdraw-savings').click());
  $('loan-wallet-withdraw-entry').addEventListener('click', () => $('withdraw-loan').click());
  $('principal').addEventListener('input', quote);
  $('save-button').addEventListener('click', () => notice('Deposits not enabled yet', 'The account is connected, but real M-Pesa deposits are not enabled yet. Do not send money to this app until the ZetuPay integration is completed and tested.'));
  $('withdraw-savings').addEventListener('click', () => notice('Withdrawals not enabled yet', 'Your balance has not changed. Savings withdrawals will be available after ZetuPay payout integration is completed and verified.'));
  $('withdraw-loan').addEventListener('click', () => notice('Withdrawals not enabled yet', 'Loan Wallet withdrawals are not enabled yet. No money has been moved.'));
  $('repay-button').addEventListener('click', () => notice('Repayment information', 'Repayment processing is not connected yet. Your outstanding balance has not changed.'));
  $('kyc-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const files = ['id-front', 'id-back', 'id-selfie'];
    for (const id of files) {
      const file = $(id).files[0];
      if (!file) return notice('Missing document', 'Please upload the front and back of your ID and a selfie.');
      if (file.size > 3 * 1024 * 1024) return notice('Image too large', 'Each ID photo or selfie must be 3 MB or smaller.');
    }
    const button = $('submit-kyc'); button.disabled = true; button.textContent = 'Submitting securely…';
    try {
      const formData = new FormData($('kyc-form'));
      formData.set('nationalId', $('kyc-id-number').value.trim());
      const response = await fetch('/api/loan/application', { method: 'POST', body: formData, credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit your application.');
      $('kyc-form').hidden = true;
      $('kyc-status').textContent = data.message || 'Your application is pending review.';
      notice('Verification submitted', 'Your ID photos and details have been submitted for review. You cannot request a loan until verification is approved.');
    } catch (error) { notice('Could not submit application', error.message); }
    finally { button.disabled = false; button.textContent = 'Submit for verification'; }
  });
  $('apply-button').addEventListener('click', async () => {
    const principal = Number($('principal').value);
    try {
      const data = await api('/api/loan/request', { method: 'POST', body: JSON.stringify({ principal }) });
      notice('Loan request submitted', `Your request for ${money(data.principal)} is pending review. Illustrative charge: ${money(data.charge)}; total repayment: ${money(data.total)} in ${data.days} days. No loan has been approved or disbursed.`);
      showDashboard();
    } catch (error) { notice('Loan quote unavailable', error.message); }
  });
  api('/api/auth/me').then(data => renderUser(data.user)).catch(() => renderUser(null));
})();
