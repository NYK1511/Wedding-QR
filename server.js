const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const ffmpeg = require('fluent-ffmpeg');

const app = express();

// Serve static files from the "public" folder
app.use(express.static('public'));
app.use(bodyParser.json());

// Serve the HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Google Drive API credentials
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

// OAuth2 client setup
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const FOLDER_ID = process.env.FOLDER_ID;

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Function to compress video
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264', 
        '-preset ultrafast', 
        '-crf 28',
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
    parents: [FOLDER_ID],
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
    console.error('Error uploading file:', error.response?.data || error.message || error);
    throw error;
  }
}

// Function to get and set the access token
async function ensureAccessToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(tokenData);

    // Check if token is expired and refresh if needed
    if (oAuth2Client.credentials.expiry_date <= Date.now()) {
      console.log('Refreshing expired access token...');
      const { credentials } = await oAuth2Client.refreshAccessToken();
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
      oAuth2Client.setCredentials(credentials);
    }
  } else {
    throw new Error('No token found. User must authenticate.');
  }
}

// Function to save tokens after initial authorization
function saveToken(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
}

// Route to handle video upload
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    await ensureAccessToken();

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
    prompt: 'consent',
    scope: SCOPES,
  });
  res.send(`Authorize this app by visiting this URL: <a href="${authUrl}" target="_blank">${authUrl}</a>`);
});

// Handle the OAuth2 callback
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    saveToken(tokens);
    res.send('Authorization successful! You can now upload videos.');
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
