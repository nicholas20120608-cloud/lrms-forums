# LRMS Forums

A sleek and intuitive forum for Lufkin Road Middle School students, built with Node.js, Express, and SQLite.

## Features

- User registration and login
- Forum posts with image uploads
- Admin panel for user management
- Direct messaging (DMs) with real-time updates
- Responsive design with friendly CSS

## Deployment on Railway

1. Fork or clone this repository to your GitHub account.
2. Go to [Railway.app](https://railway.app) and sign in.
3. Click "New Project" and select "Deploy from GitHub repo".
4. Connect your GitHub account and select the `lrms-forums` repository.
5. Click "Deploy" - Railway will automatically detect it's a Node.js app and deploy it.

The app will be live at the generated Railway URL.

## Local Development

1. Install dependencies: `npm install`
2. Run the app: `npm start`
3. Open http://localhost:3000 in your browser.

## Admin Setup

After registering, promote a user to admin via the database or by updating the role in the SQLite file.

Default admin can be set by running:
```sql
UPDATE users SET role = 'admin' WHERE username = 'yourusername';
```