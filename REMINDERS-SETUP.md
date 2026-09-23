# Automatic evaluator reminders and active members

The files are ready to merge into your existing Codirector Hub. **Email reminders are not active until you finish this setup.** Updating the website files alone does not activate server functions or scheduled email.

## What this adds

- One email per evaluation assignment and scheduled tour, normally about 24 hours before the tour. The evaluator receives it; your configured hub account is copied. If you are the evaluator, you receive one copy.
- Checks every five minutes, even when nobody has the website open. Claims made inside the reminder window are eligible at the next check. Each run sends up to three queued emails; larger queues can take longer.
- Dates and times come from the **claimed evaluation in Eval Tracker**, interpreted in `America/Indiana/Indianapolis`. The server does not read the Google workbook. If a tour moves or is cancelled, update or release its claim in Eval Tracker.
- Missing date/time, unconfirmed email addresses, inactive members, completed evaluations, skipped priorities, and non-current terms are excluded.
- **Active now** in the header, available to every signed-in active hub member. It shows names only. Visible tabs with keyboard, click, or scroll activity within five minutes count as active. It refreshes about every 30 seconds; abrupt closes, sign-outs, or lost connections can take up to 90 seconds to disappear. Multiple tabs count as one person.

## 1. Install the project files and run the database updates

This ZIP contains the complete project, including index.html. Extract its contents into your repository root. Preserve any configuration or code changes you made after the original upload when merging. Let your normal website deployment finish.

In the **existing Supabase project's SQL Editor**, run these in order:

1. `supabase/09-vanessa-submit.sql` — rerun this updated version even if you installed the earlier one. Adds detailed receipts and fixes exact submission retries under existing row permissions.
2. `supabase/10-tour-reminders.sql` — adds the disabled email queue and backend functions.
3. `supabase/11-active-users.sql` — enables the authenticated active-user list.

Do not rerun the original schema scripts. These updates assume your hub's existing schema and access policies are already installed. You can use active users and the new Vanessa features after these steps, independently of email setup.

## 2. Configure the email sender

This implementation sends through Resend. Create a Resend account, verify a sending domain you are authorized to use, and create an email-sending API key. A Purdue login does not by itself authorize sending from `purdue.edu`; use a verified sender approved for your project.

In **Supabase → Edge Functions → Secrets**, set:

| Secret | Value |
| --- | --- |
| `RESEND_API_KEY` | Your Resend API key |
| `REMINDER_CRON_SECRET` | A newly generated random secret, at least 32 characters |

Use a password manager to generate the secret. Keep it out of `config.js`, GitHub, browser code, and chat. Hosted Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its functions; those backend credentials must never go into the website.

Deploy the included `supabase/functions/tour-reminders/` directory. With the Supabase CLI, run this from your repository folder, replacing `YOUR_PROJECT_REF` with your existing project reference:

```sh
supabase functions deploy tour-reminders --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

The worker authenticates requests with the dedicated cron secret. `--no-verify-jwt` disables the gateway's user-JWT requirement for this function; it does **not** remove the worker's secret check. Do not apply that setting to unrelated functions. Include both `index.ts` and `worker.js` when using the Dashboard editor instead of the CLI.

## 3. Select your account for the copied reminders

Edit the three placeholder values below, then run this in the Supabase SQL Editor. The owner email must exactly match your active, verified hub account. No name guessing is used.

```sql
do $$
declare
  v_owner uuid;
  v_email text := 'YOUR_VERIFIED_HUB_EMAIL';
  v_sender text := 'YOUR_VERIFIED_SENDER_EMAIL';
  v_hub text := 'https://YOUR_EXISTING_HUB_ADDRESS';
begin
  select u.id into v_owner from auth.users u
    join public.members m on m.id=u.id and m.active
    where lower(u.email)=lower(v_email)
      and u.email_confirmed_at is not null;
  if v_owner is null then
    raise exception 'No active verified hub account matches that email.';
  end if;
  update public.tour_reminder_settings
    set enabled=false, owner_id=v_owner, from_email=v_sender,
        hub_url=v_hub, hours_before=24
    where singleton;
end $$;
```

Use a plain sender email address, without a display name or angle brackets. The email includes the guide's name, tour date/time, evaluator greeting, and a link to the hub. It never includes evaluation feedback.

## 4. Configure the scheduler and activate email

Enable **Cron**, **pg_net**, and **Vault** in your Supabase project. In Vault, create these two named secrets:

| Vault name | Value |
| --- | --- |
| `hub_reminder_project_url` | Your Supabase project URL, such as `https://YOUR_PROJECT_REF.supabase.co`, without a trailing slash |
| `hub_reminder_cron_secret` | The exact same value as the Edge Function's `REMINDER_CRON_SECRET` |

Finally, run **`supabase/12-enable-reminders.sql`** in the SQL Editor. This is the activation step: it creates or updates the named five-minute job and turns reminders on. From then on, eligible assignments can send real emails automatically; no per-email approval is required.

## Check operation and pause reminders

Review Supabase Cron job history, Edge Function logs, and this query:

```sql
select id, eval_id, evaluator_id, tour_date, tour_time,
       status, attempts, accepted_at, provider_id, last_error
from public.tour_reminder_deliveries
order by tour_at desc;
```

`accepted` means the email provider accepted the request, not that an inbox received or read it. Use the provider dashboard to investigate delivery, bounces, or spam filtering. `pending` and expired `sending` jobs are retried; `failed` and `cancelled` need investigation. No email-based failure alerts are implemented.

Pause future sends:

```sql
update public.tour_reminder_settings set enabled=false where singleton;
```

An email already in flight cannot be recalled. To stop scheduler invocations as well:

```sql
select cron.unschedule('hub-tour-reminders');
```

After resolving setup problems, rerun `12-enable-reminders.sql` to resume the scheduler and enable reminders. Previously cancelled/failed jobs are retained and do not automatically resend. Do not delete delivery records to force retries without checking the provider history first.

## Reliability boundaries

The queue uses database row leases, a unique assignment/date/time key, and a stable Resend idempotency key with an unchanged payload. Retries stop after eight attempts or 23 hours from the first attempt, before Resend's documented 24-hour idempotency retention expires. An unknown send result remains retryable within that window; it is not described as successful.

Assignments, recipients, completion status, and enabled settings are checked when a job is claimed. An assignment can still change between that check and the external email request. Already-sent mail cannot be undone. Rescheduled dates/times or a new evaluator form a new reminder identity. Changing email addresses or sender configuration cancels incompatible unsent jobs; it does not automatically regenerate those same assignment reminders. Messages already queued keep their original text and link.

These files do not install themselves into Supabase or create a Resend account. Live email delivery, the hosted scheduler, and your project-specific role configuration must be checked after setup. The included tests use fictional accounts and mocked email requests; no real emails or evaluations were sent during development.

Official references: [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [pg_net requests](https://supabase.com/docs/guides/database/extensions/pg_net), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
