(() => {
  let savings = 100;
  let loanWallet = 0;
  let outstanding = 0;
  const $ = (id) => document.getElementById(id);
  const money = (n) => "KSh " + Math.round(n).toLocaleString("en-KE");
  const limit = () => Math.floor(savings * 1.5);
  const days = (n) => n <= 500 ? 14 : n <= 1500 ? 21 : n <= 5000 ? 30 : n <= 10000 ? 45 : 60;
  const quote = () => {
    const n = Math.max(0, Number($("principal").value) || 0);
    const charge = Math.round(n * (20 / 150));
    $("quote-principal").textContent = money(n);
    $("quote-charge").textContent = money(charge);
    $("quote-total").textContent = money(n + charge);
    $("quote-days").textContent = days(n) + " days";
  };
  function render() {
    $("savings").textContent = money(savings);
    $("loan-wallet").textContent = money(loanWallet);
    $("loan-limit").textContent = money(limit());
    $("limit-inline").textContent = money(limit());
    $("outstanding").textContent = money(outstanding);
    $("loan-status").textContent = outstanding > 0 ? "Repay in full before a new loan" : "No active loan in this preview";
    $("apply-button").disabled = outstanding > 0;
    quote();
  }
  function notice(title, message) {
    $("notice-title").textContent = title;
    $("notice").textContent = message;
  }
  function showLoanSection() {
    $("dashboard-view").hidden = true;
    $("loan-view").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    quote();
  }
  function showDashboard() {
    $("loan-view").hidden = true;
    $("dashboard-view").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("open-loan-button").addEventListener("click", showLoanSection);
  $("back-dashboard").addEventListener("click", showDashboard);
  $("principal").addEventListener("input", quote);
  $("save-button").addEventListener("click", () => {
    savings += 100;
    render();
    notice("Demo saving recorded", "KSh 100 was added to the sample Savings Wallet. No real payment was processed.");
  });
  $("apply-button").addEventListener("click", () => {
    const principal = Number($("principal").value);
    if (outstanding > 0) {
      notice("Loan not available", "Repay your current loan in full before applying again.");
      return;
    }
    if (!Number.isFinite(principal) || principal < 1 || principal > limit()) {
      notice("Check loan amount", "Enter an amount between KSh 1 and your current limit of " + money(limit()) + ".");
      return;
    }
    const charge = Math.round(principal * (20 / 150));
    loanWallet += principal;
    outstanding = principal + charge;
    render();
    notice("Demo loan request", money(principal) + " was added to the sample Loan Wallet. Illustrative repayment is " + money(outstanding) + " in " + days(principal) + " days. No real money moved.");
    showDashboard();
  });
  $("repay-button").addEventListener("click", () => {
    if (outstanding <= 0) {
      notice("No active loan", "There is no sample loan to mark as repaid.");
      return;
    }
    outstanding = 0;
    render();
    notice("Demo repayment", "The sample loan is marked as repaid. No real repayment was processed.");
  });
  $("withdraw-savings").addEventListener("click", () => notice("Savings withdrawal", "A real M-Pesa withdrawal is not connected in this preview. Your sample balance has not changed."));
  $("withdraw-loan").addEventListener("click", () => notice("Loan Wallet withdrawal", "A real M-Pesa withdrawal is not connected in this preview. Your sample balance has not changed."));
  render();
})();
