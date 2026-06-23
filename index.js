const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();

// Middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

// Root Route
app.get('/', (req, res) => {
  res.send('RecipeHub Server is running!');
});

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Better Auth JWKS Endpoint URL থেকে পাবলিক কি সেটআপ
const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))

// 🎯 সংশোধনকৃত VerifyToken Middleware
const verifyToken = async(req, res, next) => {
  const authHeader = req.headers.authorization;

  // 🛠️ ভুল সংশোধন ১: startWith না, সঠিক মেথড হলো startsWith
  if(!authHeader || !authHeader.startsWith("Bearer ")){
    return res.status(401).json({ msg: "Unauthorized: Missing or Malformed Token"});
  }

  // 🛠️ ভুল সংশোধন ২: split("") এর বদলে স্পেস দিয়ে split(" ") করতে হবে টোকেন আলাদা করার জন্য
  const token = authHeader.split(" ")[1];

  if(!token){
    return res.status(401).json({msg:"Unauthorized: Token missing"})
  }

  try{
    // jose লাইব্রেরি দিয়ে Better Auth এর টোকেন ভেরিফাই করা
    const { payload } = await jwtVerify(token, JWKS);
    
    // ভেরিফাইড ইউজারের ডাটা রিকোয়েস্ট অবজেক্টে সেভ করে রাখা যেন নিচের API-গুলোতে ব্যবহার করা যায়
    req.user = payload; 
    console.log("Authenticated User Payload:", payload);
    next();

  }
  catch(error){
     console.error("JWT Verification Error:", error.message);
     return res.status(401).json ({msg: "Unauthorized: Invalid Token"})
  }
}

async function run() {
  try {
    // ডাটাবেজ কানেক্ট করা হচ্ছে
    await client.connect();

    const database = client.db("last_project_db");
    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("users"); 

    // ----------------------------------------------------
    // 👤 USER RELATED APIS
    // ----------------------------------------------------
    
    app.post('/api/register-user', async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        
        if (existingUser) {
          return res.status(200).send({ message: 'User already exists in database', insertedId: null });
        }

        const newUser = {
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role || "user",
          isPremium: user.isPremium || false,
          isBlocked: user.isBlocked || false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await userCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send({ error: true, message: error.message });
      }
    });

    app.put('/api/update-user/:email', verifyToken, async (req, res) => {
      try {
        const userEmail = req.params.email;
        const { name, image } = req.body;

        const updateDoc = {};
        if (name && name.trim() !== "") updateDoc.name = name;
        if (image && image.trim() !== "") updateDoc.image = image;
        updateDoc.updatedAt = new Date();

        if (Object.keys(updateDoc).length === 1) {
          return res.status(400).send({ error: true, message: 'No fields provided to update' });
        }

        const query = { email: userEmail };
        const result = await userCollection.updateOne(query, { $set: updateDoc });

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: true, message: 'User not found in database' });
        }

        res.status(200).send({ success: true, message: 'Profile updated in MongoDB successfully!' });
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ error: true, message: error.message });
      }
    });


    // ----------------------------------------------------
    // 🍳 RECIPE RELATED APIS (টোকেন প্রোটেক্টেড)
    // ----------------------------------------------------
    // 🛠️ ভুল সংশোধন ৩: এন্ডপয়েন্ট রাউট /recipes থেকে /api/recipes করলাম (ফ্রন্টএন্ডের মিল রাখার জন্য) 
    // এবং মিডলওয়্যার হিসেবে verifyToken বসিয়ে দেওয়া হলো।
    app.post('/api/recipes', verifyToken, async (req, res) => {
      try {
        const recipe = req.body;
        
        // টোকেন সিকিউরিটি: ফ্রন্টএন্ড থেকে পাঠানো ডেটার বদলে টোকেনের আসল ইউজার আইডি সেট করা
        const newRecipe = {
          ...recipe,
          authorId: req.user.id || req.user.sub, // Better Auth টোকেন থেকে আইডি নেওয়া
          likesCount: 0,
          isFeatured: false,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await recipeCollection.insertOne(newRecipe);
        res.status(201).send({ success: true, message: "Recipe stored successfully!", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // কানেকশন টেস্ট কমান্ড
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (error) {
    console.dir(error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`RecipeHub app listening on port ${port}`);
});