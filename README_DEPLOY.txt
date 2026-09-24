THE DAILY BASIS - NETLIFY SERVER DATA BUILD

This build replaces direct browser calls to Treasury/FRED/Freddie/MBA with a same-origin Netlify Function:
  /api/market-data

Folder structure:
  public/index.html
  netlify/functions/market-data.mjs
  netlify.toml

Recommended deploy to your EXISTING thedailybasis.netlify.app project:
1. Install Netlify CLI on your Windows PC:
     npm install -g netlify-cli
2. Extract this ZIP and open Command Prompt/PowerShell in this folder.
3. Log in once:
     netlify login
4. Link this folder to your existing site:
     netlify link
   Choose your existing "thedailybasis" project.
5. Create a draft deploy first:
     netlify deploy
6. Test the draft URL, especially:
     /api/market-data
7. Publish to the existing production URL:
     netlify deploy --prod

After production deploy, verify:
  https://thedailybasis.netlify.app/api/market-data
  https://thedailybasis.netlify.app/

No API keys are required for this first version. The function uses free/public sources and keeps a verified fallback snapshot if one source fails.

A scheduled function also warms the market-data endpoint at 6:00 AM and 1:00 PM Pacific on weekdays. It runs hourly but exits immediately outside those two Pacific hours so daylight-saving time is handled correctly.
