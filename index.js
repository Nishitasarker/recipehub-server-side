const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();

// Middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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

// Auth Verification Middleware
const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Unauthorized: Missing or Malformed Token" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(401).json({ msg: "Unauthorized: Invalid Token" })
  }
}

const FREE_RECIPE_LIMIT = 2;

async function run() {
  try {
    await client.connect();
    const database = client.db("last_project_db");
    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("user"); 
    const favoriteCollection = database.collection("favorites");
    const reportCollection = database.collection("reports");
    const paymentCollection = database.collection("payments");
    const purchasedRecipesCollection = database.collection("purchased_recipes");
    const likeCollection = database.collection("likes");


    // ----------------------------------------------------
    // 📊 1. DASHBOARD REAL-TIME METRICS GENERATOR API
    // ----------------------------------------------------
    app.get('/api/user-stats/:email', async (req, res) => {
      try {
        const userEmail = req.params.email;

        if (!userEmail) {
          return res.status(400).send({ success: false, message: "Email parameter is required" });
        }

        // ১. payments কালেকশন থেকে চেক করা হচ্ছে এই ইমেইলে কোনো সফল পেমেন্ট আছে কি না
        const paymentDoc = await paymentCollection.findOne({ 
          userEmail: userEmail, 
          paymentStatus: "paid" 
        });
        const isPremium = !!paymentDoc;

        // ২. এই ইউজারের নিজের তৈরি করা মোট রেসিপি সংখ্যা কাউন্ট
        const totalRecipes = await recipeCollection.countDocuments({ authorEmail: userEmail });

        // ৩. এই ইউজারের তৈরি করা রেসিপিগুলোতে টোটাল কত লাইক এসেছে তার যোগফল
        const recipes = await recipeCollection.find({ authorEmail: userEmail }).toArray();
        const totalLikesReceived = recipes.reduce((sum, recipe) => sum + (recipe.likesCount || 0), 0);

        // ৪. এই ইউজার নিজে কয়টি রেসিপি ফেভারিট লিস্টে যোগ করেছে তার কাউন্ট ($or ব্যবহার করা হয়েছে নিখুঁত সার্চের জন্য)
        const totalFavorites = await favoriteCollection.countDocuments({ 
          $or: [
            { userEmail: userEmail },
            { email: userEmail },
            { authorEmail: userEmail }
          ]
        });

        res.status(200).send({
          success: true,
          isPremium,
          totalRecipes,
          totalFavorites,
          totalLikesReceived
        });
      } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 🍳 2. RECIPE ADD (CREATE) API WITH FREE LIMIT
    // ----------------------------------------------------
    app.post('/api/recipes', verifyToken, async (req, res) => {
      try {
        const authorId = req.user.id || req.user.sub;
        const authorEmail = req.user.email;

        // চেক করা হচ্ছে ইউজার প্রিমিয়াম কি না (payments কালেকশন থেকে)
        const paymentDoc = await paymentCollection.findOne({ userEmail: authorEmail, paymentStatus: "paid" });
        const isPremium = !!paymentDoc;

        if (!isPremium) {
          // ফ্রি ইউজার হলে লিমিট চেক
          const existingCount = await recipeCollection.countDocuments({ authorEmail });
          if (existingCount >= FREE_RECIPE_LIMIT) {
            return res.status(403).send({
              success: false,
              code: "RECIPE_LIMIT_REACHED",
              message: `ফ্রি প্ল্যানে সর্বোচ্চ ${FREE_RECIPE_LIMIT}টি রেসিপি যোগ করা যায়। দয়া করে প্রিমিয়ামে আপগ্রেড করুন।`
            });
          }
        }

        const recipeData = req.body;
        const newRecipe = {
          recipeName: recipeData.recipeName,
          category: recipeData.category,
          cuisineType: recipeData.cuisineType,
          difficultyLevel: recipeData.difficultyLevel || "Easy",
          preparationTime: parseInt(recipeData.preparationTime) || 10,
          ingredients: Array.isArray(recipeData.ingredients) ? recipeData.ingredients : [recipeData.ingredients],
          instructions: recipeData.instructions,
          recipeImage: recipeData.recipeImage,
          authorId,
          authorName: req.user.name || "Unknown Chef",
          authorEmail: authorEmail,
          likesCount: 0,
          isFeatured: false,
          status: "pending", 
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await recipeCollection.insertOne(newRecipe);
        res.status(201).send({ 
          success: true, 
          message: "Recipe stored successfully!", 
          insertedId: result.insertedId 
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 🔍 3. GET ALL RECIPES
    // ----------------------------------------------------
    app.get('/api/recipes', async (req, res) => {
      try {
        const recipes = await recipeCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).send(recipes);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 🔍 4. GET SINGLE RECIPE BY ID
    // ----------------------------------------------------
    app.get('/api/recipes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }
        const query = { _id: new ObjectId(id) };
        const recipe = await recipeCollection.findOne(query);
        
        if (!recipe) {
          return res.status(404).send({ success: false, message: "Recipe not found" });
        }
        res.status(200).send(recipe);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get('/api/popular-recipes', async (req, res) => {
  try {
    const popular = await recipeCollection
      .find({})                 
      .sort({ likesCount: -1 }) 
      .limit(6)                 
      .toArray();
    res.status(200).send(popular);
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

// ইউজার কোন রেসিপিতে like/favorite করেছে তা চেক করার জন্য
app.get('/api/user-actions/:email/:recipeId', async (req, res) => {
  try {
    const { email, recipeId } = req.params;
    
    const favorite = await favoriteCollection.findOne({
      userEmail: email,
      recipeId: recipeId.toString()
    });

    const like = await likeCollection.findOne({
      userEmail: email,
      recipeId: recipeId.toString()
    });

    res.status(200).send({
      success: true,
      isFavorite: !!favorite,
      isLiked: !!like,
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

    // ----------------------------------------------------
    // 🛒 5. CHECK PURCHASE STATUS FOR A RECIPE
    // ----------------------------------------------------
    app.get('/api/check-purchase', async (req, res) => {
      try {
        const { email, recipeId } = req.query;

        if (!email || !recipeId) {
          return res.status(400).send({ success: false, message: "Missing email or recipeId" });
        }

        const purchasedDoc = await purchasedRecipesCollection.findOne({
          userEmail: email,
          recipeId: recipeId.toString(),
          paymentStatus: "paid"
        });

        res.status(200).send({ isPurchased: !!purchasedDoc });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 💳 6. STRIPE CHECKOUT SESSION CREATION
    // ----------------------------------------------------
    app.post('/api/create-checkout-session', verifyToken, async (req, res) => {
      try {
        const { recipeId, recipeName, price } = req.body;
        const userEmail = req.user.email;

        if (!recipeId || !price) {
          return res.status(400).send({ success: false, message: "Missing required fields" });
        }

        const sessionId = `cs_test_${new ObjectId().toString()}`; 
        const mockSessionUrl = `${process.env.CLIENT_URL}/browseRecipes/${recipeId}?payment_success=true&session_id=${sessionId}`;
        
        await paymentCollection.insertOne({
          transactionId: sessionId,
          amount: parseFloat(price),
          paidAt: new Date(),
          paymentStatus: "pending",
          userEmail: userEmail,
          recipeId: recipeId
        });

        res.send({ url: mockSessionUrl });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 🎯 7. VERIFY & SAVE PURCHASE HISTORY
    // ----------------------------------------------------
    app.post('/api/verify-purchase', verifyToken, async (req, res) => {
      try {
        const { sessionId, recipeId } = req.body;
        const email = req.user.email;

        if (!sessionId || !recipeId) {
          return res.status(400).send({ success: false, message: "Session ID and Recipe ID are required" });
        }

        const existingPurchase = await purchasedRecipesCollection.findOne({
          userEmail: email,
          recipeId: recipeId.toString(),
          paymentStatus: "paid"
        });

        if (existingPurchase) {
          return res.status(200).send({ success: true, message: "Recipe already unlocked" });
        }

        await paymentCollection.updateOne(
          { transactionId: sessionId },
          { $set: { paymentStatus: "paid", paidAt: new Date() } }
        );

        const newPurchaseDoc = {
          userEmail: email,
          recipeId: recipeId.toString(),
          purchaseType: "single_recipe",
          stripeSessionId: sessionId,
          paymentStatus: "paid",
          purchasedAt: new Date()
        };

        const result = await purchasedRecipesCollection.insertOne(newPurchaseDoc);
        res.status(201).send({ 
          success: true, 
          message: "Payment success verified and recipe unlocked!", 
          insertedId: result.insertedId 
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // server.js এ এই route যোগ করো (run() ফাংশনের ভেতরে)
app.patch('/api/recipes/like/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { userEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid ID" });
    }
    if (!userEmail) {
      return res.status(400).send({ success: false, message: "userEmail required" });
    }

    const alreadyLiked = await likeCollection.findOne({ recipeId: id, userEmail });
    if (alreadyLiked) {
      return res.status(400).send({ success: false, message: "Already liked" });
    }

    await likeCollection.insertOne({ recipeId: id, userEmail, likedAt: new Date() });
    await recipeCollection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { likesCount: 1 } }
    );

    res.status(200).send({ success: true, message: "Like added!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


    // ----------------------------------------------------
    // ❤️ 8. ADD TO FAVORITES (New)
    // ----------------------------------------------------
    app.post('/api/favorites', verifyToken, async (req, res) => {
      try {
        const { recipeId, recipeName, recipeImage } = req.body;
        const userEmail = req.user.email;

        if (!recipeId) {
          return res.status(400).send({ success: false, message: "Recipe ID is required" });
        }

        const existingFavorite = await favoriteCollection.findOne({
          userEmail: userEmail,
          recipeId: recipeId.toString()
        });

        if (existingFavorite) {
          return res.status(400).send({ success: false, message: "Already added to favorites" });
        }

        const favoriteDoc = {
          userEmail: userEmail,
          recipeId: recipeId.toString(),
          recipeName,
          recipeImage,
          addedAt: new Date()
        };

        const result = await favoriteCollection.insertOne(favoriteDoc);
        res.status(201).send({ 
          success: true, 
          message: "Added to favorites successfully!", 
          insertedId: result.insertedId 
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 💔 9. REMOVE FROM FAVORITES (New)
    // ----------------------------------------------------
    app.delete('/api/favorites', verifyToken, async (req, res) => {
      try {
        const { recipeId } = req.body;
        const userEmail = req.user.email;

        if (!recipeId) {
          return res.status(400).send({ success: false, message: "Recipe ID is required" });
        }

        const result = await favoriteCollection.deleteOne({
          userEmail: userEmail,
          recipeId: recipeId.toString()
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ success: false, message: "Favorite item not found" });
        }

        res.status(200).send({ success: true, message: "Removed from favorites successfully!" });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    console.log("Connected successfully to MongoDB!");
  } catch (error) {
    console.dir(error);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`RecipeHub app listening on port ${port}`);
});