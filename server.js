const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const marked = require("marked");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended:true }));

app.use(session({
    secret:"xp-secret",
    resave:false,
    saveUninitialized:false
}));

const db = new sqlite3.Database("database.db");

db.serialize(()=>{

    db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        email TEXT UNIQUE,
        password TEXT,
        is_admin INTEGER DEFAULT 0
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        content TEXT,
        created_at TEXT
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        content TEXT
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER
    )
    `);

});

function requireLogin(req,res,next){

    if(!req.session.user){
        return res.redirect("/login");
    }

    next();
}

function renderPage(
    res,
    page,
    data={}
){

    const pageHtml =
        ejs.render(

            fs.readFileSync(
                path.join(
                    __dirname,
                    "views",
                    page + ".ejs"
                ),
                "utf8"
            ),

            data

        );

    const layoutHtml =
        ejs.render(

            fs.readFileSync(
                path.join(
                    __dirname,
                    "views",
                    "layout.ejs"
                ),
                "utf8"
            ),

            {
                title:
                    data.title ||
                    "XP Blog",

                body:pageHtml
            }

        );

    res.send(layoutHtml);
}

app.get("/",(req,res)=>{

    db.all(`
    SELECT posts.*,
           users.username
    FROM posts
    JOIN users
    ON posts.user_id = users.id
    ORDER BY posts.id DESC
    `,
    (err,posts)=>{

        renderPage(
            res,
            "index",
            {
                title:"ホーム",
                posts,
                user:req.session.user
            }
        );

    });

});

app.get("/register",(req,res)=>{

    renderPage(
        res,
        "register",
        {
            title:"新規登録"
        }
    );

});

app.post("/register",
async (req,res)=>{

    const {
        username,
        email,
        password
    } = req.body;

    const hash =
        await bcrypt.hash(
            password,
            10
        );

    const isAdmin =
        email ===
        "rimsky.yamatov@gmail.com"
        ? 1 : 0;

    db.run(`
    INSERT INTO users
    (username,email,password,is_admin)
    VALUES(?,?,?,?)
    `,
    [
        username,
        email,
        hash,
        isAdmin
    ],
    err=>{

        if(err){
            return res.send(
                "登録失敗"
            );
        }

        res.redirect("/login");

    });

});

app.get("/login",(req,res)=>{

    renderPage(
        res,
        "login",
        {
            title:"ログイン"
        }
    );

});

app.post("/login",
(req,res)=>{

    const {
        email,
        password
    } = req.body;

    db.get(`
    SELECT * FROM users
    WHERE email=?
    `,
    [email],
    async (err,user)=>{

        if(!user){
            return res.send(
                "ユーザーなし"
            );
        }

        const ok =
            await bcrypt.compare(
                password,
                user.password
            );

        if(!ok){
            return res.send(
                "パスワード違う"
            );
        }

        req.session.user =
            user;

        res.redirect("/");

    });

});

app.get("/logout",
(req,res)=>{

    req.session.destroy(()=>{

        res.redirect("/");

    });

});

app.get("/create",
requireLogin,
(req,res)=>{

    renderPage(
        res,
        "create",
        {
            title:"記事作成"
        }
    );

});

app.post("/create",
requireLogin,
(req,res)=>{

    const {
        title,
        content
    } = req.body;

    db.run(`
    INSERT INTO posts
    (user_id,title,content,created_at)
    VALUES(?,?,?,datetime('now'))
    `,
    [
        req.session.user.id,
        title,
        content
    ],
    ()=>{

        res.redirect("/");

    });

});

app.get("/post/:id",
(req,res)=>{

    db.get(`
    SELECT posts.*,
           users.username
    FROM posts
    JOIN users
    ON posts.user_id = users.id
    WHERE posts.id=?
    `,
    [req.params.id],
    (err,post)=>{

        if(!post){
            return res.send(
                "記事なし"
            );
        }

        const html =
            marked.parse(
                post.content
            );

        db.all(`
        SELECT comments.*,
               users.username
        FROM comments
        JOIN users
        ON comments.user_id = users.id
        WHERE comments.post_id=?
        ORDER BY comments.id DESC
        `,
        [req.params.id],
        (err,comments)=>{

            db.get(`
            SELECT COUNT(*) as count
            FROM likes
            WHERE post_id=?
            `,
            [req.params.id],
            (err,likeData)=>{

                renderPage(
                    res,
                    "post",
                    {
                        title:
                            post.title,

                        post,
                        html,
                        comments,

                        likes:
                            likeData.count,

                        user:
                            req.session.user
                    }
                );

            });

        });

    });

});

app.post("/comment/:id",
requireLogin,
(req,res)=>{

    db.run(`
    INSERT INTO comments
    (post_id,user_id,content)
    VALUES(?,?,?)
    `,
    [
        req.params.id,
        req.session.user.id,
        req.body.content
    ],
    ()=>{

        res.redirect(
            "/post/" +
            req.params.id
        );

    });

});

app.post("/like/:id",
requireLogin,
(req,res)=>{

    db.get(`
    SELECT * FROM likes
    WHERE post_id=?
    AND user_id=?
    `,
    [
        req.params.id,
        req.session.user.id
    ],
    (err,row)=>{

        if(row){

            return res.redirect(
                "/post/" +
                req.params.id
            );

        }

        db.run(`
        INSERT INTO likes
        (post_id,user_id)
        VALUES(?,?)
        `,
        [
            req.params.id,
            req.session.user.id
        ],
        ()=>{

            res.redirect(
                "/post/" +
                req.params.id
            );

        });

    });

});

app.get("/edit/:id",
requireLogin,
(req,res)=>{

    db.get(`
    SELECT * FROM posts
    WHERE id=?
    `,
    [req.params.id],
    (err,post)=>{

        if(!post){
            return res.send(
                "記事なし"
            );
        }

        const isOwner =
            post.user_id ===
            req.session.user.id;

        if(!isOwner){

            return res.send(
                "編集不可"
            );

        }

        renderPage(
            res,
            "edit",
            {
                title:"記事編集",
                post
            }
        );

    });

});

app.post("/edit/:id",
requireLogin,
(req,res)=>{

    db.get(`
    SELECT * FROM posts
    WHERE id=?
    `,
    [req.params.id],
    (err,post)=>{

        const isOwner =
            post.user_id ===
            req.session.user.id;

        if(!isOwner){

            return res.send(
                "編集不可"
            );

        }

        db.run(`
        UPDATE posts
        SET title=?,
            content=?
        WHERE id=?
        `,
        [
            req.body.title,
            req.body.content,
            req.params.id
        ],
        ()=>{

            res.redirect(
                "/post/" +
                req.params.id
            );

        });

    });

});

app.post("/delete/:id",
requireLogin,
(req,res)=>{

    db.get(`
    SELECT * FROM posts
    WHERE id=?
    `,
    [req.params.id],
    (err,post)=>{

        const isOwner =
            post.user_id ===
            req.session.user.id;

        const isAdmin =
            req.session.user
            .is_admin === 1;

        if(
            !isOwner &&
            !isAdmin
        ){

            return res.send(
                "削除不可"
            );

        }

        db.run(`
        DELETE FROM posts
        WHERE id=?
        `,
        [req.params.id],
        ()=>{

            res.redirect("/");

        });

    });

});

const PORT =
    process.env.PORT || 3000;

app.listen(PORT,()=>{

    console.log(
        "Server running"
    );

});
