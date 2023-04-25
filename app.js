//set up the server
const express = require( "express" );
const logger = require("morgan");
const { auth } = require('express-openid-connect');
const { requiresAuth } = require('express-openid-connect');
const dotenv = require('dotenv');
dotenv.config();

const DEBUG = true;

const helmet = require("helmet");
const db = require('./db/db_pool');
const path = require("path");
const app = express();
const port = process.env.PORT || 8080;

// Configure Express to use EJS
app.set( "views",  __dirname + "/views");
app.set( "view engine", "ejs" );

//Configure Express to use certain HTTP headers for security
//Explicitly set the CSP to allow the source of Materialize
app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'cdnjs.cloudflare.com'],
      }
    }
})); 
  
const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.AUTH0_BASE_URL,
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

// Configure Express to parse incoming JSON data
// app.use( express.json() );
// Configure Express to parse URL-encoded POST request bodies (traditional forms)
app.use( express.urlencoded({ extended: false }) );

// define middleware that logs all incoming requests
app.use(logger("dev"));

// define middleware that serves static resources in the public directory
app.use(express.static(__dirname + '/public'));

// define middleware that appends useful auth-related information to the res object
// so EJS can easily access it
app.use((req, res, next) => {
    res.locals.isLoggedIn = req.oidc.isAuthenticated();
    res.locals.user = req.oidc.user;
    console.log(req.oidc.user)
    next();
})

// req.isAuthenticated is provided from the auth router
app.get('/authtest', (req, res) => {
    res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out');
});

app.get('/profile', requiresAuth(), (req, res) => {
    res.send(JSON.stringify(req.oidc.user));
});

// define a route for the default home page
app.get( "/", ( req, res ) => {
    res.render('index');
} );

const read_categories_all_sql = `
    SELECT
        name
    FROM 
        categories
    WHERE
        userId = ?
`

app.get( "/categories", requiresAuth(), ( req, res ) => {
    db.execute(read_categories_all_sql, [req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            res.render('categories', { inventory : results });
        }
    });
} );

const delete_categories_sql = `
    DELETE 
    FROM
        categories
    WHERE
        name = ?
    AND
        userId = ?
`

app.get("/categories/item/:name/delete", requiresAuth(), ( req, res ) => {
    db.execute(delete_categories_sql, [req.params.name, req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            res.redirect("/categories");
        }
    });
})

// define a route for item CREATE
const create_categories_sql = `
    INSERT INTO categories
        (name, userId)
    VALUES
        (?, ?)
`
app.post("/categories", requiresAuth(), ( req, res ) => {
    db.execute(create_categories_sql, [req.body.name, req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            //results.insertId has the primary key (id) of the newly inserted element.
            res.redirect(`/categories`);
        }
    });
})

// define a route for the stuff inventory page
const read_stuff_all_sql = `
    SELECT 
        id, item, quantity
    FROM
        stuff
    WHERE 
        userId = ?
`
app.get( "/stuff", requiresAuth(), ( req, res ) => {
    db.execute(read_stuff_all_sql, [req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            db.execute(read_categories_all_sql, [req.oidc.user.sid], (error2, results2) => {
                if (DEBUG) console.log(error2 ? error2 : results);
                if (error2)
                    res.status(500).send(error2); //Internal Server Error
                else {
                    let data = {stuffList: results, categoriesList: results2};
                    res.render('stuff', data); 
                }
            });
        }
    });
});

// define a route for the item detail page
const read_stuff_item_sql = `
    SELECT 
        id, item, quantity, description, categoryName 
    FROM
        stuff
    WHERE
        id = ?
    AND
        userId = ?
`

app.get( "/stuff/item/:id", requiresAuth(), ( req, res ) => {
    db.execute(read_categories_all_sql, [req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else if (results.length == 0)
            res.status(404).send(`No item found with id = "${req.params.id}"` ); // NOT FOUND
        else {
            db.execute(read_stuff_item_sql, [req.params.id, req.oidc.user.sid], (error2, results2) => {
                if (DEBUG) console.log(error2 ? error2 : results2);
                if (error2)
                    res.status(500).send(error2); //Internal Server Error
                else {
                    let data = {categoriesList: results, stuffList: results2};
                    res.render('item', data); 
                }
            });

            //let stuffList = results[0]; // results is still an array
            // stuffList's object structure: 
            //  { id: ____, item: ___ , quantity:___ , description: ____ }
            //res.render('/stuff/item/', stuffList);
        }
    });
});

// define a route for item DELETE
const delete_item_sql = `
    DELETE 
    FROM
        stuff
    WHERE
        id = ?
    AND
        userId = ?
`
app.get("/stuff/item/:id/delete", requiresAuth(), ( req, res ) => {
    db.execute(delete_item_sql, [req.params.id, req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            res.redirect("/stuff");
        }
    });
})

// define a route for item UPDATE
const update_item_sql = `
    UPDATE
        stuff
    SET
        item = ?,
        quantity = ?,
        description = ?,
        categoryName = ?
    WHERE
        id = ?
    AND
        userId = ?
`
app.post("/stuff/item/:id", requiresAuth(), ( req, res ) => {
    
            db.execute(update_item_sql, [req.body.name, req.body.quantity, req.body.description, req.body.categoryName, req.params.id, req.oidc.user.sid], (error2, results2) => {
                if (DEBUG) console.log(error2 ? error2 : results2);
                if (error2)
                    res.status(500).send(error2); //Internal Server Error
                else {
                    res.redirect(`/stuff/item/${req.params.id}`);
                }
            });
        
})

// define a route for item CREATE
const create_item_sql = `
    INSERT INTO stuff
        (item, quantity, categoryName, userId)
    VALUES
        (?, ?, ?, ?)
`

app.post("/stuff", requiresAuth(), ( req, res ) => {
    db.execute(create_item_sql, [req.body.name, req.body.quantity, req.body.category, req.oidc.user.sid], (error, results) => {
        if (DEBUG) console.log(error ? error : results);
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            //results.insertId has the primary key (id) of the newly inserted element.
            res.redirect(`/stuff/item/${results.insertId}`);
        }
    });
})

// start the server
app.listen( port, () => {
    console.log(`App server listening on ${ port }. (Go to http://localhost:${ port })` );
} );