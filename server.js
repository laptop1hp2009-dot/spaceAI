const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

function loadEnv() {
    const envPath = path.join(__dirname, ".env");

    if (!fs.existsSync(envPath)) {
        return {};
    }

    const text = fs.readFileSync(envPath, "utf8");
    const env = {};

    text.split(/\r?\n/).forEach(function (line) {
        line = line.trim();

        if (!line || line.startsWith("#")) {
            return;
        }

        const equalIndex = line.indexOf("=");

        if (equalIndex === -1) {
            return;
        }

        const key = line.slice(0, equalIndex).trim();
        let value = line.slice(equalIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    });

    return env;
}

const ENV = loadEnv();

/* Render uses process.env.
   Your local computer can still use .env. */
const GROQ_API_KEY =
    process.env.GROQ_API_KEY || ENV.GROQ_API_KEY;

function sendJSON(res, statusCode, data) {
    const body = JSON.stringify(data);

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
    });

    res.end(body);
}

function sendFile(res, filePath, contentType) {
    fs.readFile(filePath, function (error, data) {
        if (error) {
            sendJSON(res, 404, {
                error: "File not found."
            });
            return;
        }

        res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": data.length
        });

        res.end(data);
    });
}

function readRequestBody(req) {
    return new Promise(function (resolve, reject) {
        let body = "";

        req.on("data", function (chunk) {
            body += chunk.toString();

            if (body.length > 1000000) {
                reject(new Error("Request is too large."));
                req.destroy();
            }
        });

        req.on("end", function () {
            resolve(body);
        });

        req.on("error", reject);
    });
}

async function askGroq(question) {
    if (!GROQ_API_KEY) {
        throw new Error(
            "GROQ_API_KEY is missing from the environment."
        );
    }

    const systemPrompt = `
You are Space AI.

You answer ONLY questions about space, astronomy, astrophysics,
planetary science, cosmology, spacecraft, rockets, satellites,
stars, galaxies, black holes, exoplanets, the Solar System,
the Universe, and closely related space science.

Understand the user's complete question semantically.
Do not just search for individual keywords.

Give the answer directly first.
Then explain the important reasoning or facts clearly.

The answer should normally be 4 to 8 spoken sentences:
detailed enough to be useful, but not unnecessarily long.

Do not begin with a story or historical background unless the
question specifically asks for history.

Do not mention Wikipedia, Groq, NASA, Google, websites,
sources, databases, APIs, or where you obtained information.

Do not use emojis.

Do not use markdown formatting.

If the question is not about space, politely say that you only
answer questions about space and astronomy.

If the question asks for a date, year, distance, size, mass,
temperature, time, event, discovery, comparison, or other
specific fact, give the requested fact clearly and directly.

For calculations or comparisons, actually reason through the
question rather than giving a generic explanation.
`;

    const requestBody = JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: question
            }
        ],
        temperature: 0.2,
        max_completion_tokens: 700
    });

    const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + GROQ_API_KEY,
                "Content-Type": "application/json"
            },
            body: requestBody
        }
    );

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            "Groq API error " +
            response.status +
            ": " +
            responseText
        );
    }

    let data;

    try {
        data = JSON.parse(responseText);
    } catch (error) {
        throw new Error("Groq returned invalid JSON.");
    }

    if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message
    ) {
        throw new Error("Groq returned an unexpected response.");
    }

    return data.choices[0].message.content;
}

const server = http.createServer(async function (req, res) {

    if (req.method === "GET" && req.url === "/") {
        const indexPath = path.join(__dirname, "index.html");

        sendFile(
            res,
            indexPath,
            "text/html; charset=utf-8"
        );

        return;
    }

    if (
        req.method === "POST" &&
        req.url === "/api/ask"
    ) {
        try {
            const body = await readRequestBody(req);

            let data;

            try {
                data = JSON.parse(body);
            } catch (error) {
                sendJSON(res, 400, {
                    error: "Invalid JSON request."
                });
                return;
            }

            const question = String(
                data.question || ""
            ).trim();

            if (!question) {
                sendJSON(res, 400, {
                    error: "No question was provided."
                });
                return;
            }

            console.log("Space question:", question);

            const answer = await askGroq(question);

            sendJSON(res, 200, {
                answer: answer
            });

            return;

        } catch (error) {
            console.error("SERVER ERROR:");
            console.error(error.message);

            sendJSON(res, 500, {
                error: error.message
            });

            return;
        }
    }

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });

        res.end();
        return;
    }

    sendJSON(res, 404, {
        error: "Not found."
    });
});

server.on("error", function (error) {
    console.error("SERVER FAILED TO START:");
    console.error(error.message);
});

server.listen(PORT, HOST, function () {
    console.log("");
    console.log("====================================");
    console.log("        SPACE AI SERVER");
    console.log("====================================");
    console.log("");
    console.log(
        "Server running on port " + PORT
    );
    console.log("");
    console.log(
        "GROQ API KEY:"
    );
    console.log(
        GROQ_API_KEY
            ? "Detected"
            : "NOT DETECTED"
    );
    console.log("");
    console.log("====================================");
});