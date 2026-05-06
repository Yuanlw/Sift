update smart_quota_accounts
set monthly_credit_limit = null,
    updated_at = now()
where enforcement_mode = 'unlimited'
  and plan_code = 'local'
  and monthly_credit_limit = 10000;
