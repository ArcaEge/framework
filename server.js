// Does a somewhat hacky thing to make serving media files work
// I used AI for this file, can't be bothered to learn express.js
import express from 'express';
import path from 'node:path';
import { handler } from './build/handler.js';
// import { CronJob } from 'cron';

// new CronJob(
// 	'* * * * * *', // cronTime
// 	function () {
// 		console.log('You will see this message every second');
// 	}, // onTick
// 	null, // onComplete
// 	true, // start
// 	'Europe/London' // timeZone
// );

const UPLOADS = path.resolve(process.env.UPLOADS_PATH);

const app = express();

// Serve uploads
app.use('/uploads', express.static(UPLOADS));

// Let SvelteKit handle all other routes
app.use(handler);

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
});