const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();

// Middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors({
    origin: "http://localhost:3000", // আপনার ফ্রন্টএন্ড URL
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
}));


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
// Auth Verification Middleware (সংশোধিত)

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("Received Auth Header:", authHeader);

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Missing Token" });
    }

    const token = authHeader.split(" ")[1];

    if (!token || token === "undefined" || token === "null") {
      return res.status(401).json({ success: false, message: "Token is null" });
    }

    // MongoDB-তে Better Auth-এর session collection থেকে সরাসরি verify
    const db = client.db("last_project_db");
    const sessionCollection = db.collection("session"); // Better Auth এই নামে session রাখে

    const sessionDoc = await sessionCollection.findOne({ token: token });

    if (!sessionDoc) {
      return res.status(401).json({ success: false, message: "Session not found" });
    }

    // Session expire হয়েছে কিনা চেক
    if (new Date(sessionDoc.expiresAt) < new Date()) {
      return res.status(401).json({ success: false, message: "Session expired" });
    }

    // User collection থেকে user info নিয়ে আসো
    const userCol = db.collection("user");
    const user = await userCol.findOne({ _id: sessionDoc.userId });

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    req.user = {
      id: user.id || user._id.toString(),
      email: user.email,
      name: user.name,
    };

    next();
  } catch (error) {
    console.error("Auth Error:", error.message);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
};


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


    // ----------------------------------------------------
// 🛒 GET USER'S PURCHASED RECIPES (with full recipe details)
// ----------------------------------------------------
app.get('/api/my-purchased-recipes', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    // ১. এই ইউজারের সব successful purchase খুঁজে আনা
    const purchases = await purchasedRecipesCollection
      .find({ userEmail: email, paymentStatus: "paid" })
      .sort({ purchasedAt: -1 })
      .toArray();

    if (purchases.length === 0) {
      return res.status(200).send({ success: true, data: [] });
    }

    // ২. recipeId গুলো ObjectId এ কনভার্ট করে recipes কালেকশন থেকে ডিটেইলস আনা
    const recipeIds = purchases
      .filter(p => ObjectId.isValid(p.recipeId))
      .map(p => new ObjectId(p.recipeId));

    const recipes = await recipeCollection
      .find({ _id: { $in: recipeIds } })
      .toArray();

    // ৩. পারচেজ ইনফো আর রেসিপি ডিটেইলস একসাথে merge করা
    const merged = purchases.map((purchase) => {
      const recipe = recipes.find(r => r._id.toString() === purchase.recipeId);
      return {
        purchaseId: purchase._id,
        recipeId: purchase.recipeId,
        amount: purchase.amount,
        purchasedAt: purchase.purchasedAt || purchase.paidAt,
        recipeName: recipe?.recipeName || "Recipe Unavailable",
        recipeImage: recipe?.recipeImage || null,
        category: recipe?.category || "N/A",
        cuisineType: recipe?.cuisineType || "N/A",
        preparationTime: recipe?.preparationTime || null,
        authorName: recipe?.authorName || "Unknown Chef",
      };
    });

    res.status(200).send({ success: true, data: merged });
  } catch (error) {
    console.error("My Purchased Recipes Error:", error);
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

app.patch('/api/recipes/unlike/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { userEmail } = req.body;
    if (!ObjectId.isValid(id)) return res.status(400).send({ success: false, message: "Invalid ID" });
    if (!userEmail) return res.status(400).send({ success: false, message: "userEmail required" });

    const existingLike = await likeCollection.findOne({ recipeId: id, userEmail });
    if (!existingLike) return res.status(400).send({ success: false, message: "Not liked yet" });

    await likeCollection.deleteOne({ recipeId: id, userEmail });
    await recipeCollection.updateOne({ _id: new ObjectId(id) }, { $inc: { likesCount: -1 } });

    res.status(200).send({ success: true, message: "Like removed!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


    // ----------------------------------------------------
    // ❤️ 8. ADD TO FAVORITES (New)
    // ----------------------------------------------------
   app.post('/api/favorites', async (req, res) => {
  try {
    const { recipeId, recipeName, recipeImage, userEmail } = req.body;
    if (!recipeId || !userEmail) {
      return res.status(400).send({ success: false, message: "Recipe ID and email required" });
    }
    const existing = await favoriteCollection.findOne({ userEmail, recipeId: recipeId.toString() });
    if (existing) {
      return res.status(400).send({ success: false, message: "Already added to favorites" });
    }
    const result = await favoriteCollection.insertOne({
      userEmail, recipeId: recipeId.toString(), recipeName, recipeImage, addedAt: new Date()
    });
    res.status(201).send({ success: true, message: "Added to favorites!", insertedId: result.insertedId });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

app.delete('/api/favorites', async (req, res) => {
  try {
    const { recipeId, userEmail } = req.body;
    if (!recipeId || !userEmail) {
      return res.status(400).send({ success: false, message: "Recipe ID and email required" });
    }
    const result = await favoriteCollection.deleteOne({ userEmail, recipeId: recipeId.toString() });
    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "Favorite not found" });
    }
    res.status(200).send({ success: true, message: "Removed from favorites!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


// ----------------------------------------------------
// ❤️ GET USER'S FAVORITE RECIPES
// ----------------------------------------------------
app.get('/api/my-favorites', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }
    const myFavorites = await favoriteCollection.find({ userEmail: email }).toArray();
    res.status(200).send({ success: true, data: myFavorites });
  } catch (error) {
    console.error("Fetch Favorites Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});


   //  এই কোডটি দিয়ে প্রতিস্থাপন (Replace) করুন:
app.get('/api/my-recipes', verifyToken, async (req, res) => {
  try {
    // ১. প্রথমে টোকেন থেকে ইমেইল বা আইডি বের করার চেষ্টা করি
    let authorEmail = req.user?.email;
    const userId = req.user?.id || req.user?.sub;

    // ২. যদি টোকেনে সরাসরি ইমেইল না থাকে, তবে ডাটাবেজের 'user' কালেকশন থেকে আইডি দিয়ে ইমেইলটি খুঁজে আনবো
    if (!authorEmail && userId) {
      const dbUser = await userCollection.findOne({ 
        $or: [
          { _id: userId },
          { _id: new ObjectId(userId) },
          { uid: userId } // Firebase ব্যবহার করলে uid থাকতে পারে
        ]
      });
      if (dbUser) {
        authorEmail = dbUser.email;
      }
    }

    // ৩. যদি কোনোভাবেই ইমেইল না পাওয়া যায়, তবে এরর রেসপন্স দেবো
    if (!authorEmail) {
      return res.status(400).send({ 
        success: false, 
        message: "ইউজারের ইমেইল পাওয়া যায়নি। টোকেন বা ডাটাবেজ চেক করুন।" 
      });
    }

    // ৪. এবার নিখুঁতভাবে recipes কালেকশনের authorEmail এর সাথে ম্যাচ করে রেসিপি নিয়ে আসবো
    const query = { authorEmail: authorEmail };
    const myRecipes = await recipeCollection.find(query).sort({ createdAt: -1 }).toArray();
    
    res.status(200).send({ success: true, data: myRecipes });
  } catch (error) {
    console.error("My Recipes Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});

    
   // ----------------------------------------------------
    // 📝 10. UPDATE RECIPE WITH OWNER CHECK (সংশোধিত)
    // ----------------------------------------------------
    app.put('/api/recipes/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        // টোকেন বা ইউজার কালেকশন থেকে ইমেইল বের করা
        let authorEmail = req.user?.email;
        const userId = req.user?.id || req.user?.sub;
        if (!authorEmail && userId) {
          const dbUser = await userCollection.findOne({ 
            $or: [{ _id: userId }, { _id: new ObjectId(userId) }, { uid: userId }]
          });
          if (dbUser) authorEmail = dbUser.email;
        }

        if (!authorEmail) {
          return res.status(400).send({ success: false, message: "User email not found." });
        }

        // চেক করা হচ্ছে রেসিপিটি আসলেই এই ইউজারের কি না
        const recipe = await recipeCollection.findOne({ _id: new ObjectId(id) });
        if (!recipe) {
          return res.status(404).send({ success: false, message: "Recipe not found" });
        }
        if (recipe.authorEmail !== authorEmail) {
          return res.status(403).send({ success: false, message: "Unauthorized: You can only update your own recipes" });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            recipeName: updatedData.recipeName,
            category: updatedData.category,
            cuisineType: updatedData.cuisineType,
            difficultyLevel: updatedData.difficultyLevel,
            preparationTime: parseInt(updatedData.preparationTime) || 10,
            ingredients: Array.isArray(updatedData.ingredients) ? updatedData.ingredients : [updatedData.ingredients],
            instructions: updatedData.instructions,
            recipeImage: updatedData.recipeImage,
            status: "pending", // আপডেট করলে অ্যাডমিনের রিভিউর জন্য আবার pending হবে
            updatedAt: new Date()
          }
        };

        const result = await recipeCollection.updateOne(filter, updateDoc);
        res.status(200).send({ success: true, message: "Recipe updated successfully!", result });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ----------------------------------------------------
    // 🗑️ 11. DELETE RECIPE WITH OWNER CHECK (সংশোধিত)
    // ----------------------------------------------------
    app.delete('/api/recipes/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        // টোকেন বা ইউজার কালেকশন থেকে ইমেইল বের করা
        let authorEmail = req.user?.email;
        const userId = req.user?.id || req.user?.sub;
        if (!authorEmail && userId) {
          const dbUser = await userCollection.findOne({ 
            $or: [{ _id: userId }, { _id: new ObjectId(userId) }, { uid: userId }]
          });
          if (dbUser) authorEmail = dbUser.email;
        }

        if (!authorEmail) {
          return res.status(400).send({ success: false, message: "User email not found." });
        }

        // সিকিউরিটি চেক: ওনারশিপ ভেরিফিকেশন
        const recipe = await recipeCollection.findOne({ _id: new ObjectId(id) });
        if (!recipe) {
          return res.status(404).send({ success: false, message: "Recipe not found" });
        }
        if (recipe.authorEmail !== authorEmail) {
          return res.status(403).send({ success: false, message: "Unauthorized: You can only delete your own recipes" });
        }

        const result = await recipeCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).send({ success: true, message: "Recipe deleted successfully!", result });
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