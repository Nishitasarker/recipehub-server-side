const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');

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

async function run() {
  try {
    // ডাটাবেজ কানেক্ট করা হচ্ছে
    await client.connect();

    const database = client.db("last_project_db");
    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("users"); // 🎯 ইউজার কালেকশন ডিক্লেয়ার করা হলো

    // ----------------------------------------------------
    // 👤 USER RELATED APIS
    // ----------------------------------------------------
    
    // ফ্রন্টএন্ডের রেজিস্ট্রেশন ফর্ম থেকে ইউজার ডেটা ব্যাকএন্ডে সেভ করার এন্ডপয়েন্ট
    app.post('/api/register-user', async (req, res) => {
      try {
        const user = req.body;
        
        // ইমেইল অলরেডি ডাটাবেজে আছে কিনা চেক করা (ডুপ্লিকেট এড়াতে)
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        
        if (existingUser) {
          return res.status(200).send({ message: 'User already exists in database', insertedId: null });
        }

        // রিকোয়ারমেন্ট অনুযায়ী অবজেক্ট স্ট্রাকচার নিশ্চিত করা
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


    // ----------------------------------------------------
    // 🍳 RECIPE RELATED APIS
    // ----------------------------------------------------
    app.post('/recipes', async (req, res) => {
      try {
        const recipe = req.body;
        const result = await recipeCollection.insertOne(recipe);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: true, message: error.message });
      }
    });

    // কানেকশন টেস্ট কমান্ড
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (error) {
    console.dir(error);
  }
  // ⚠️ CRITICAL: এখানে থাকা 'await client.close();' লাইনটি মুছে দেওয়া হয়েছে যাতে এক্সপ্রেস রিকোয়েস্টের মাঝে কানেকশন ড্রপ না করে।
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`RecipeHub app listening on port ${port}`);
});