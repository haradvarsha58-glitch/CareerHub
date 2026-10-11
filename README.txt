Job and Recruitment System
==========================

One-click static mode
---------------------
Open frontend/index.html with VS Code Live Server. The frontend automatically
uses its built-in demo jobs and browser storage; no Java process is required.
Jobs, applications, registered prototype accounts, and login state are saved
in the current browser when local storage is available.

Demo accounts
-------------
Candidate: candidate@jobly.in / demo123
Recruiter: recruiter@jobly.in / demo123

The recruiter account can post vacancies and manage applicant stages. Use
"Create account" to create a candidate or recruiter account in this browser.
This local prototype authentication is for demonstration only and is not a
production security or identity system.

Optional Java backend
---------------------
The frontend checks its own origin and local Java server addresses for the API.
When found, jobs and applications use the Java backend; account state remains
in browser storage because the API does not implement authentication.

From this project folder, run:
    java backend/Server.java

Then open http://localhost:8080, or continue using the Live Server tab. The API
allows local cross-origin requests so Live Server can reach the Java process.
To use another backend origin, add it to the frontend URL, for example:
    http://localhost:5500/?backend=http://localhost:8080

Project files
-------------
backend/Server.java   Optional Java 17+ REST API and static file server
frontend/index.html   Application markup and dialogs
frontend/style.css    Responsive application styling
frontend/app.js       Backend detection, demo engine, auth, search, and flows
