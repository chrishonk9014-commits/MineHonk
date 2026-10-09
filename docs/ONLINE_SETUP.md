# Putting MineHonk online (one-time setup, no terminal)

Browser multiplayer needs a small "hub": accounts, friends, join codes, the
list of public worlds, and the helper that connects players to each other. It
runs for free on Cloudflare. A GitHub workflow in this repository installs and
updates it for you. Everything below happens in your web browser, and you only
do it once (about 5 minutes).

You need:

- the GitHub account that owns this repository
- an email address for a free Cloudflare account (no credit card)

---

## 1. Create a free Cloudflare account

1. Open **https://dash.cloudflare.com/sign-up**.
2. Enter your email and a password, then press **Sign up**.
3. Open the email from Cloudflare and click the verification link.
4. If Cloudflare asks what you want to do first, you can skip it. You don't
   need a website or a domain.

## 2. Turn on Workers (and pick your workers.dev name)

1. In the Cloudflare dashboard, open **Workers & Pages** in the left menu.
   (It may be inside a group called **Compute**.)
2. If Cloudflare asks you to choose a **workers.dev subdomain**, type a short
   name (for example your GitHub name) and confirm. Your hub's address will be
   `https://minehonk-hub.<that-name>.workers.dev`.
3. If it shows a **Create** button and nothing else, that's fine: you don't
   need to create anything here. Keep the page open for the next step.

## 3. Copy your Account ID

1. Still on **Workers & Pages**, look on the right side for **Account details**.
2. Next to **Account ID**, press **Click to copy** (a 32-character code of
   letters and digits).
3. Paste it somewhere for a minute (a note), you'll need it in step 5.

(Another place to find it: the dashboard's home page, menu **⋯** next to your
account name → **Copy account ID**.)

## 4. Create an API token

1. In the top-right corner of the dashboard, open the person icon →
   **My Profile**.
2. Choose **API Tokens** in the left menu, then press **Create Token**.
3. Find the template **Edit Cloudflare Workers** and press **Use template**.
4. Under **Permissions**, press **+ Add more** and add one more row:
   **Account** → **D1** → **Edit**. (The hub keeps accounts and friends in a
   D1 database.)
5. Under **Account Resources**, choose **Include** → your account.
6. Under **Zone Resources**, leave **All zones** (the hub doesn't use any).
7. Press **Continue to summary**, then **Create Token**.
8. Press **Copy** next to the token. Cloudflare shows it only once. If you
   lose it, just make a new one.

## 5. Give the two values to GitHub

1. Open this repository on GitHub.
2. Go to **Settings** (top bar of the repository) → **Secrets and variables**
   (left menu) → **Actions**.
3. Press **New repository secret**:
   - **Name:** `CLOUDFLARE_API_TOKEN`
   - **Secret:** paste the token from step 4
   - press **Add secret**
4. Press **New repository secret** again:
   - **Name:** `CLOUDFLARE_ACCOUNT_ID`
   - **Secret:** paste the Account ID from step 3
   - press **Add secret**

Names must be exactly as written (capital letters, underscores).

## 6. Start the deploy

1. Open the **Actions** tab of this repository.
2. In the left list, choose **Deploy online hub**.
3. Either:
   - press **Run workflow** (on the right), pick the branch with the game,
     and press the green **Run workflow** button; or
   - if there is already a red ✗ run in the list (it ran before the secrets
     existed), open it and press **Re-run all jobs**.
4. Wait about a minute for the green ✓. Open the run: the summary says
   **MineHonk hub is online** with its address.

That's it. From now on the workflow runs by itself whenever the hub's code
changes, and it never touches your players' data. Running it again by hand is
always safe.

## Optional: Cloudflare TURN (more direct connections)

Players connect to a host directly when their networks allow it, and through
the hub's relay otherwise. A TURN server lets more players connect directly
through strict networks (some schools, offices and mobile networks). Cloudflare
includes 1,000 GB of TURN traffic a month for free.

1. In the Cloudflare dashboard, open **Realtime** → **TURN Server** →
   **Create** (any name).
2. Copy the **Turn Token ID** and the **API Token** it shows.
3. In GitHub (**Settings → Secrets and variables → Actions**) add:
   - `TURN_KEY_ID` = the Turn Token ID
   - `TURN_KEY_API_TOKEN` = the API Token
4. Run **Deploy online hub** again (step 6).

## If something goes wrong

The failed run's summary lists the usual fixes. The common ones:

| Message in the run | What to do |
| --- | --- |
| *Cloudflare is not set up yet* | Add the two secrets (step 5), then **Re-run all jobs**. |
| *You need to register a workers.dev subdomain* | Do step 2, then re-run. |
| *Authentication error* / code 10000 | The token is wrong or expired. Make a new one (step 4) and replace `CLOUDFLARE_API_TOKEN`. |
| *Could not create or find the D1 database* | The token is missing **D1 → Edit** (step 4, item 4). |

Nothing here costs money: the free plan simply pauses the hub for the rest of
the day if a limit is ever reached (see [MULTIPLAYER.md](MULTIPLAYER.md#free-plan-limits)).
