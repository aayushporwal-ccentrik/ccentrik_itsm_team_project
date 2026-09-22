

// ============================================================
// IMPORTS
// ============================================================

const cds = require("@sap/cds");
const crypto = require("crypto");
const express = require("express");

const { CognitoJwtVerifier } = require("aws-jwt-verify");

const {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    RespondToAuthChallengeCommand,
    AdminCreateUserCommand,
    AdminDeleteUserCommand,
    AdminAddUserToGroupCommand,
    AdminRemoveUserFromGroupCommand,
    AdminListGroupsForUserCommand,
    AdminEnableUserCommand,
    AdminDisableUserCommand,
    ForgotPasswordCommand,
    ConfirmForgotPasswordCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const { CDS_ROLE_BY_CODE } = require("./roles");

const { SELECT, UPDATE } = cds.ql;


// ============================================================
// CONFIGURATION
// ============================================================

const REGION = process.env.COGNITO_REGION;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;

if (!REGION || !USER_POOL_ID || !CLIENT_ID) {
    throw new Error(
        "AUTH_PROVIDER=cognito needs COGNITO_REGION, " +
        "COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID"
    );
}

const CREDENTIALS_MESSAGE = "Invalid email or password.";

const INACTIVE_MESSAGE =
    "Your account is inactive. Please contact your administrator.";

const SESSION_MESSAGE =
    "Your session has expired. Please login again.";

const cognito = new CognitoIdentityProviderClient({
    region: REGION
});

const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID,
    tokenUse: "id"
});


// ============================================================
// COGNITO HELPERS
// ============================================================

/*
 * Generate SECRET_HASH only when the Cognito app client
 * was created with a client secret.
 */
function secretHash(username) {
    if (!CLIENT_SECRET) {
        return undefined;
    }

    return crypto
        .createHmac("sha256", CLIENT_SECRET)
        .update(username + CLIENT_ID)
        .digest("base64");
}


/*
 * Add SECRET_HASH to Cognito authentication parameters
 * when required.
 */
function authParams(extra) {
    const params = Object.assign({}, extra);
    const hash = secretHash(params.USERNAME);

    if (hash) {
        params.SECRET_HASH = hash;
    }

    return params;
}


/*
 * Only ITSM role groups are considered valid roles.
 */
function rolesFromGroups(groups) {
    return (groups || []).filter(
        group => CDS_ROLE_BY_CODE[group]
    );
}


/*
 * Get all Cognito groups assigned to a user.
 */
async function groupsOf(username) {
    const out = await cognito.send(
        new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: username
        })
    );

    return (out.Groups || []).map(
        group => group.GroupName
    );
}


// ============================================================
// ITSM USER ↔ COGNITO USER MAPPING
// ============================================================

/*
 * Cognito uses "sub" as its user identifier.
 *
 * ITSM uses User.userId everywhere else.
 *
 * This function connects the two identities.
 */

const userBySub = new Map();

async function itsmUser(sub, email) {
    if (userBySub.has(sub)) {
        return userBySub.get(sub);
    }

    const { User } = cds.entities("itsm.master");

    let user = await SELECT.one
        .from(User)
        .where({ cognitoUserId: sub });

    /*
     * Backward compatibility:
     * If the user was created before cognitoUserId existed,
     * try matching once by email and then save the Cognito sub.
     */
    if (!user && email) {
        user = await SELECT.one
            .from(User)
            .where({ email });

        if (user) {
            await UPDATE(User)
                .set({ cognitoUserId: sub })
                .where({ userId: user.userId });
        }
    }

    if (!user) {
        return null;
    }

    const entry = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        isActive: user.isActive
    };

    userBySub.set(sub, entry);

    return entry;
}


function forgetUser(sub) {
    if (sub) {
        userBySub.delete(sub);
    }
}


// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

/*
 * Logo/content endpoints are public because an <img> request
 * cannot send the Authorization header.
 */
const PUBLIC_GET_PATTERNS = [
    /\/logoContent(\?.*|$)/
];


/*
 * Determine which role the user is currently working as.
 *
 * If the frontend sends X-Active-Role, make sure that role
 * actually exists in the Cognito groups.
 */
function activeRole(req, roles) {
    const asked = req.headers["x-active-role"];

    if (asked && roles.includes(asked)) {
        return asked;
    }

    return roles.length === 1 ? roles[0] : null;
}


/*
 * Authenticate every request using the Cognito ID token.
 */
async function cognitoAuth(req, res, next) {
    let payload = null;

    const header = req.headers.authorization || "";

    if (header.startsWith("Bearer ")) {
        try {
            payload = await verifier.verify(
                header.slice(7)
            );
        } catch (error) {
            payload = null;
        }
    }

    if (payload) {
        const roles = rolesFromGroups(
            payload["cognito:groups"]
        );

        const role = activeRole(req, roles);

        const user = role
            ? await itsmUser(payload.sub, payload.email)
            : null;

        if (user && user.isActive !== false) {
            req.user = new cds.User({
                id: user.userId,
                roles: [
                    CDS_ROLE_BY_CODE[role]
                ].filter(Boolean)
            });

            req.user.email = user.email;
            req.user.roleCode = role;
            req.user.roleCodes = roles;
            req.user.cognitoSub = payload.sub;

            return next();
        }
    }

    /*
     * Allow only the explicitly configured public assets
     * without authentication.
     */
    if (
        req.method === "GET" &&
        PUBLIC_GET_PATTERNS.some(
            pattern => pattern.test(req.path)
        )
    ) {
        req.user = new cds.User({
            id: "public-asset-reader",
            roles: []
        });
    } else {
        req.user = cds.User.anonymous;
    }

    next();
}


// ============================================================
// LOGIN
// ============================================================

/*
 * Login using Cognito.
 */
async function onLogin(req, res) {
    const email = String(req.body.email || "")
        .trim()
        .toLowerCase();

    const password = String(
        req.body.password || ""
    );

    if (!email || !password) {
        return res.status(400).json({
            message: "Email and password are required."
        });
    }

    let out;

    try {
        out = await cognito.send(
            new InitiateAuthCommand({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: CLIENT_ID,
                AuthParameters: authParams({
                    USERNAME: email,
                    PASSWORD: password
                })
            })
        );
    } catch (error) {
        if (
            error.name === "UserNotConfirmedException" ||
            error.name === "PasswordResetRequiredException"
        ) {
            return res.status(403).json({
                message:
                    "Your password needs to be reset. " +
                    "Use 'Forgot Password?' to continue."
            });
        }

        return res.status(401).json({
            message: CREDENTIALS_MESSAGE
        });
    }

    /*
     * Admin-created users initially have a temporary password.
     * Cognito requires them to change it before login completes.
     */
    if (
        out.ChallengeName ===
        "NEW_PASSWORD_REQUIRED"
    ) {
        return res.json({
            authenticated: false,
            passwordChangeRequired: true,
            session: out.Session,
            email
        });
    }

    return respondWithSession(
        res,
        out.AuthenticationResult,
        email
    );
}


/*
 * Common session response used after:
 *
 * 1. Normal login
 * 2. Initial password change
 */
async function respondWithSession(
    res,
    result,
    email
) {
    if (!result || !result.IdToken) {
        return res.status(401).json({
            message: CREDENTIALS_MESSAGE
        });
    }

    const roles = rolesFromGroups(
        await groupsOf(email)
    );

    if (!roles.length) {
        return res.status(403).json({
            message:
                "No role is assigned to your account. " +
                "Please contact your administrator."
        });
    }

    const payload = await verifier.verify(
        result.IdToken
    );

    const user = await itsmUser(
        payload.sub,
        payload.email
    );

    if (!user) {
        return res.status(403).json({
            message:
                "Your account is not set up in ITSM. " +
                "Please contact your administrator."
        });
    }

    if (user.isActive === false) {
        return res.status(403).json({
            message: INACTIVE_MESSAGE
        });
    }

    const body = {
        authenticated: true,

        user: {
            id: user.userId,
            name: user.name,
            email: user.email
        },

        requiresRoleSelection:
            roles.length > 1,

        token: result.IdToken
    };

    if (body.requiresRoleSelection) {
        body.roles = await describeRoles(roles);
    } else {
        body.role = roles[0];
    }

    res.json(body);
}


// ============================================================
// INITIAL PASSWORD
// ============================================================

/*
 * Complete Cognito's NEW_PASSWORD_REQUIRED challenge.
 */
async function onSetInitialPassword(req, res) {
    const email = String(req.body.email || "")
        .trim()
        .toLowerCase();

    const password = String(
        req.body.password || ""
    );

    const session = String(
        req.body.session || ""
    );

    if (password.length < 8) {
        return res.status(400).json({
            message:
                "Password must be at least 8 characters."
        });
    }

    if (
        password !==
        String(req.body.confirmPassword || "")
    ) {
        return res.status(400).json({
            message: "Passwords do not match."
        });
    }

    let out;

    try {
        out = await cognito.send(
            new RespondToAuthChallengeCommand({
                ChallengeName:
                    "NEW_PASSWORD_REQUIRED",

                ClientId: CLIENT_ID,

                Session: session,

                ChallengeResponses:
                    authParams({
                        USERNAME: email,
                        NEW_PASSWORD: password
                    })
            })
        );
    } catch (error) {
        return res.status(400).json({
            message:
                passwordPolicyMessage(error)
        });
    }

    return respondWithSession(
        res,
        out.AuthenticationResult,
        email
    );
}


// ============================================================
// ROLE SELECTION
// ============================================================

/*
 * Convert Cognito role codes into the display information
 * used by the role selection UI.
 */
async function describeRoles(roles) {
    const { LookupValue } =
        cds.entities("itsm.master");

    const lookups = await SELECT
        .from(LookupValue)
        .where({
            lookupType: "ROLE"
        });

    return roles.map(code => {
        const lookup = lookups.find(
            item => item.code === code
        );

        return {
            code,
            name: lookup?.name || code,
            description:
                lookup?.description || ""
        };
    });
}


/*
 * Select the role the user wants to work as.
 *
 * No new token is generated.
 * The selected role is sent as X-Active-Role on later requests.
 */
async function onSelectRole(req, res) {
    const header =
        req.headers.authorization || "";

    let payload = null;

    if (header.startsWith("Bearer ")) {
        try {
            payload = await verifier.verify(
                header.slice(7)
            );
        } catch (error) {
            payload = null;
        }
    }

    if (!payload) {
        return res.status(401).json({
            message: SESSION_MESSAGE
        });
    }

    const role = String(
        req.body.role || ""
    );

    const roles = rolesFromGroups(
        payload["cognito:groups"]
    );

    if (!roles.includes(role)) {
        return res.status(403).json({
            message:
                "You are not authorized for this role."
        });
    }

    const user = await itsmUser(
        payload.sub,
        payload.email
    );

    if (!user || user.isActive === false) {
        return res.status(403).json({
            message: INACTIVE_MESSAGE
        });
    }

    res.json({
        token: header.slice(7),
        role,
        user: {
            id: user.userId,
            name: user.name,
            email: user.email
        }
    });
}


// ============================================================
// PASSWORD RESET
// ============================================================

/*
 * Ask Cognito to send the password reset code.
 *
 * Always return the same response so users cannot discover
 * whether an email exists in the system.
 */
async function onForgotPassword(req, res) {
    const email = String(
        req.body.email || ""
    )
        .trim()
        .toLowerCase();

    if (email) {
        try {
            await cognito.send(
                new ForgotPasswordCommand({
                    ClientId: CLIENT_ID,
                    Username: email,
                    SecretHash:
                        secretHash(email)
                })
            );
        } catch (error) {
            console.error(
                "Cognito forgot-password failed:",
                error.name
            );
        }
    }

    res.json({
        message:
            "If an account exists for this email, " +
            "a password reset link has been sent."
    });
}


/*
 * Confirm the password reset code received from Cognito.
 */
async function onResetPassword(req, res) {
    const email = String(
        req.body.email || ""
    )
        .trim()
        .toLowerCase();

    const code = String(
        req.body.token || ""
    );

    const password = String(
        req.body.password || ""
    );

    // Cognito emails a code, not a link, and a code on its own does not say
    // who is resetting — the address has to come with it.
    if (!email || !code) {
        return res.status(400).json({
            message:
                "Enter the email address and the code from the reset email."
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            message:
                "Password must be at least 8 characters."
        });
    }

    if (
        password !==
        String(req.body.confirmPassword || "")
    ) {
        return res.status(400).json({
            message: "Passwords do not match."
        });
    }

    try {
        await cognito.send(
            new ConfirmForgotPasswordCommand({
                ClientId: CLIENT_ID,
                Username: email,
                ConfirmationCode: code,
                Password: password,
                SecretHash:
                    secretHash(email)
            })
        );
    } catch (error) {
        if (
            error.name === "ExpiredCodeException" ||
            error.name === "CodeMismatchException"
        ) {
            return res.status(400).json({
                message:
                    "This password reset link has expired. " +
                    "Please request a new one."
            });
        }

        return res.status(400).json({
            message:
                passwordPolicyMessage(error)
        });
    }

    res.json({
        message:
            "Password reset successfully."
    });
}


/*
 * Convert Cognito password-policy errors into a UI message.
 */
function passwordPolicyMessage(error) {
    if (
        error.name ===
        "InvalidPasswordException"
    ) {
        return (
            error.message ||
            "Password does not meet the required policy."
        );
    }

    return (
        "Could not set the password. " +
        "Please try again."
    );
}


// ============================================================
// ADMIN → COGNITO USER SYNCHRONIZATION
// ============================================================

/*
 * Called when an Admin creates an ITSM user.
 *
 * ITSM creates/owns the application user.
 * Cognito creates the authentication identity.
 *
 * Cognito then sends the invitation email.
 */
async function createUser(user, roles) {
    const email = String(
        user.email || ""
    )
        .trim()
        .toLowerCase();

    const out = await cognito.send(
        new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,

            Username: email,

            UserAttributes: [
                {
                    Name: "email",
                    Value: email
                },
                {
                    Name: "email_verified",
                    Value: "true"
                },
                {
                    Name: "name",
                    Value: user.name || email
                }
            ]
        })
    );

    const sub = (
        out.User.Attributes || []
    ).find(
        attribute => attribute.Name === "sub"
    )?.Value;

    /*
     * Assign the roles selected by the admin.
     *
     * If role assignment fails, delete the Cognito user
     * so we don't leave a half-created account.
     */
    try {
        for (const role of roles) {
            await cognito.send(
                new AdminAddUserToGroupCommand({
                    UserPoolId: USER_POOL_ID,
                    Username: email,
                    GroupName: role
                })
            );
        }
    } catch (error) {
        await deleteUser(email);
        throw error;
    }

    return sub;
}


/*
 * Delete a Cognito user.
 *
 * Used mainly for rollback if user creation fails midway.
 */
async function deleteUser(email) {
    try {
        await cognito.send(
            new AdminDeleteUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: email
            })
        );
    } catch (error) {
        console.error(
            "Cognito rollback delete failed:",
            error.name
        );
    }
}


/*
 * Synchronize Cognito groups with the roles saved by the Admin.
 */
async function setUserRoles(user, roles) {
    const email = String(
        user.email || ""
    )
        .trim()
        .toLowerCase();

    const current = await groupsOf(email);

    /*
     * Add newly selected roles.
     */
    for (
        const role of roles.filter(
            role => !current.includes(role)
        )
    ) {
        await cognito.send(
            new AdminAddUserToGroupCommand({
                UserPoolId: USER_POOL_ID,
                Username: email,
                GroupName: role
            })
        );
    }

    /*
     * Remove roles that are no longer selected.
     */
    for (
        const role of rolesFromGroups(current)
            .filter(
                role => !roles.includes(role)
            )
    ) {
        await cognito.send(
            new AdminRemoveUserFromGroupCommand({
                UserPoolId: USER_POOL_ID,
                Username: email,
                GroupName: role
            })
        );
    }

    forgetUser(user.cognitoUserId);
}


/*
 * Enable/disable the Cognito account when the ITSM Admin
 * changes the user's active status.
 *
 * The ITSM User row is kept for historical ticket data.
 */
async function setUserActive(user, isActive) {
    const email = String(
        user.email || ""
    )
        .trim()
        .toLowerCase();

    const Command = isActive
        ? AdminEnableUserCommand
        : AdminDisableUserCommand;

    await cognito.send(
        new Command({
            UserPoolId: USER_POOL_ID,
            Username: email
        })
    );

    forgetUser(user.cognitoUserId);
}


/*
 * Resend the Cognito invitation.
 *
 * If the user has already completed the initial password
 * setup, fall back to Cognito's normal password reset flow.
 */
async function sendPasswordSetupEmail(user) {
    const email = String(
        user.email || ""
    )
        .trim()
        .toLowerCase();

    try {
        await cognito.send(
            new AdminCreateUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: email,
                MessageAction: "RESEND",
                UserAttributes: [
                    {
                        Name: "email",
                        Value: email
                    }
                ]
            })
        );
    } catch (error) {
        await cognito.send(
            new ForgotPasswordCommand({
                ClientId: CLIENT_ID,
                Username: email,
                SecretHash:
                    secretHash(email)
            })
        );
    }
}


// ============================================================
// ROUTES
// ============================================================

/*
 * Prevent internal errors/stack traces from being returned
 * directly to the browser.
 */
function guard(handler) {
    return function (req, res) {
        Promise.resolve(
            handler(req, res)
        ).catch(function (error) {
            console.error(
                "Auth request failed:",
                error
            );

            res.status(500).json({
                message:
                    "Something went wrong. Please try again."
            });
        });
    };
}


/*
 * Mount all Cognito authentication endpoints.
 */
function mountAuthRoutes(app) {
    const router = express.Router();

    router.use(express.json());

    router.post(
        "/login",
        guard(onLogin)
    );

    router.post(
        "/select-role",
        guard(onSelectRole)
    );

    router.post(
        "/forgot-password",
        guard(onForgotPassword)
    );

    router.post(
        "/reset-password",
        guard(onResetPassword)
    );

    router.post(
        "/set-initial-password",
        guard(onSetInitialPassword)
    );

    app.use("/auth", router);
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = cognitoAuth;

module.exports.mountAuthRoutes =
    mountAuthRoutes;

module.exports.sendPasswordSetupEmail =
    sendPasswordSetupEmail;

module.exports.createUser =
    createUser;

module.exports.deleteUser =
    deleteUser;

module.exports.setUserRoles =
    setUserRoles;

module.exports.setUserActive =
    setUserActive;