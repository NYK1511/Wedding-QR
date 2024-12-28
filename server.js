const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const ffmpeg = require('fluent-ffmpeg'); // Import ffmpeg for video compression

const app = express();

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'my-first-node-app', 'public')));
 // This ensures CSS and other static files are served
app.use(bodyParser.json());

// Serve the HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join('my-first-node-app', 'index.html'));
});

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Google Drive API credentials
const CREDENTIALS_PATH = path.join('/etc/secrets/credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

// OAuth2 client setup
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
const { client_id, client_secret, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Function to compress video
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264', // Use H.264 codec for compression
        '-preset fast', // Set the preset to "fast" for quicker compression
        '-crf 28',      // Set the quality; lower is better quality
      ])
      .save(outputPath)
      .on('end', () => {
        console.log(`Compression finished: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error during compression:', err);
        reject(err);
      });
  });
}

// Function to upload video to Google Drive
async function uploadToDrive(filePath, fileName) {
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });

  const fileMetadata = {
    name: fileName,
    parents: ['152xi57MG8R4NSfRVVPRcOsbHKMdujD4J'], // Replace with your folder ID
  };
  const media = {
    mimeType: 'video/mp4',
    body: fs.createReadStream(filePath),
  };

  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    console.log('File uploaded successfully:', file.data.id);
    return file.data.id;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// Function to get and set the access token
function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(TOKEN_PATH)) {
      fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return reject('No token found');
        oAuth2Client.setCredentials(JSON.parse(token));
        resolve();
      });
    } else {
      reject('No token found');
    }
  });
}

// Function to save token after initial authorization
function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
}

// Express route to handle video upload
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    // Ensure the user is authenticated
    await getAccessToken();

    if (!req.file) {
      throw new Error('No file uploaded');
    }

    const originalPath = req.file.path;
    const compressedPath = path.join('uploads', `compressed-${req.file.originalname}`);

    // Compress the video
    await compressVideo(originalPath, compressedPath);

    // Upload the compressed video
    const fileId = await uploadToDrive(compressedPath, req.file.originalname);

    // Cleanup local files
    fs.unlinkSync(originalPath);
    fs.unlinkSync(compressedPath);

    res.json({ message: 'Video uploaded successfully!', fileId });
  } catch (error) {
    console.error('Error during upload:', error);
    res.status(500).json({ error: 'Video upload failed', details: error.message });
  }
});

// Generate the OAuth2 authorization URL
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.send(`Authorize this app by visiting this URL: <a href="${authUrl}" target="_blank">${authUrl}</a>`);
});

// Handle the OAuth2 callback (after user has authorized)
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    saveToken(tokens);
    res.send('Authorization successful, you can now upload videos.');
  } catch (error) {
    console.error('Error retrieving access token:', error);
    res.status(500).send('Error during authentication');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
