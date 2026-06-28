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
    origin: "https://recipe-hub-one-peach.vercel.app", 
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

// async function run() {
//   try {
//     await client.connect();
    
 client.connect(()=>{
  console.log('connecting to MONGODB')
 }).catch(console.dir) 

    const database = client.db("last_project_db");
    const recipeCollection = database.collection("recipes");
    const userCollection = database.collection("user"); 
    const favoriteCollection = database.collection("favorites");
    const reportCollection = database.collection("reports");
    const paymentCollection = database.collection("payments");
    const purchasedRecipesCollection = database.collection("purchased_recipes");
    const likeCollection = database.collection("likes");


   
   app.get('/api/user-stats/:email', async (req, res) => {
  try {
    const userEmail = req.params.email;

    if (!userEmail) {
      return res.status(400).send({ success: false, message: "Email parameter is required" });
    }

       const userDoc = await userCollection.findOne({ email: userEmail });
    const isPremium = userDoc?.isPremium === true;

       const totalRecipes = await recipeCollection.countDocuments({ authorEmail: userEmail });

       const recipes = await recipeCollection.find({ authorEmail: userEmail }).toArray();
    const totalLikesReceived = recipes.reduce((sum, recipe) => sum + (recipe.likesCount || 0), 0);

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

       app.post('/api/recipes', verifyToken, async (req, res) => {
      try {
        const authorId = req.user.id || req.user.sub;
        const authorEmail = req.user.email;

        const paymentDoc = await paymentCollection.findOne({ userEmail: authorEmail, paymentStatus: "paid" });
        const isPremium = !!paymentDoc;

        if (!isPremium) {
                   const existingCount = await recipeCollection.countDocuments({ authorEmail });
          if (existingCount >= FREE_RECIPE_LIMIT) {
            return res.status(403).send({
              success: false,
              code: "RECIPE_LIMIT_REACHED",
              message: `You can add a maximum of ${FREE_RECIPE_LIMIT} recipes on the free plan. Please upgrade to Premium to continue.`
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

  app.get('/api/recipes', async (req, res) => {
  try {
    const { 
      isFeatured, 
      page = 1, 
      limit = 9, 
      category, 
      search 
    } = req.query;

    let query = {};

    
    if (isFeatured === 'true') {
      query.isFeatured = true;
    }

   
    if (category && category !== 'All') {
      query.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { recipeName: searchRegex },
        { cuisineType: searchRegex }
      ];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.max(parseInt(limit) || 9, 1);
    const skip = (pageNum - 1) * limitNum;

  
    const totalCount = await recipeCollection.countDocuments(query);

   
    const recipes = await recipeCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.status(200).send({
      success: true,
      data: recipes,
      pagination: {
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
        currentPage: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});
  

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

     const report = await reportCollection.findOne({
      reporterEmail: email,
      recipeId: recipeId.toString()
    });

    res.status(200).send({
      success: true,
      isFavorite: !!favorite,
      isLiked: !!like,
      isReported: !!report,
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

   
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


   
app.get('/api/my-purchased-recipes', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    
    const purchases = await purchasedRecipesCollection
      .find({ userEmail: email, paymentStatus: "paid" })
      .sort({ purchasedAt: -1 })
      .toArray();

    if (purchases.length === 0) {
      return res.status(200).send({ success: true, data: [] });
    }

        const recipeIds = purchases
      .filter(p => ObjectId.isValid(p.recipeId))
      .map(p => new ObjectId(p.recipeId));

    const recipes = await recipeCollection
      .find({ _id: { $in: recipeIds } })
      .toArray();

    
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



app.post('/api/save-purchase', async (req, res) => {
  try {
    const { email, recipeId, purchaseType, sessionId, amount } = req.body;

    if (!email || !sessionId) {
      return res.status(400).send({ success: false, message: "Email and sessionId are required" });
    }

        const alreadyPaid = await paymentCollection.findOne({ transactionId: sessionId });
    const alreadyPurchased = await purchasedRecipesCollection.findOne({ transactionId: sessionId });
    if (alreadyPaid || alreadyPurchased) {
      return res.status(200).send({ success: true, message: "Already processed" });
    }

    if (purchaseType === "single_recipe" && recipeId) {
      
      await purchasedRecipesCollection.insertOne({
        userEmail: email,
        recipeId: recipeId.toString(),
        purchaseType: "single_recipe",
        transactionId: sessionId,
        amount: amount || 4.99,
        paymentStatus: "paid",
        purchasedAt: new Date()
      });
    } else {
      
      await paymentCollection.insertOne({
        userEmail: email,
        amount: amount || 19.99,
        transactionId: sessionId,
        paymentStatus: "paid",
        paidAt: new Date()
      });

      await userCollection.updateOne(
        { email },
        { $set: { isPremium: true, updatedAt: new Date() } }
      );
    }

    res.status(201).send({ success: true, message: "Purchase saved successfully!" });
  } catch (error) {
    console.error("Save Purchase Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});

    
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



app.post('/api/reports', async (req, res) => {
  try {
    const { recipeId, userEmail, reason } = req.body;

    if (!recipeId || !userEmail || !reason) {
      return res.status(400).send({ success: false, message: "Missing required fields" });
    }

    
    const alreadyReported = await reportCollection.findOne({ recipeId, reporterEmail: userEmail });
    if (alreadyReported) {
       return res.status(400).send({ success: false, message: "You have already reported this recipe!" });
    }

    const reportDoc = {
      recipeId,
      reporterEmail: userEmail,
      reason,
      status: "pending",
      createdAt: new Date()
    };
    const result = await reportCollection.insertOne(reportDoc);
    res.status(201).send({ success: true, message: "Report submitted!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});



app.get('/api/admin-stats', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const requestingUser = await userCollection.findOne({ email });
    if (!requestingUser || requestingUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    
    const totalUsers = await userCollection.countDocuments({ role: "user" });
    const totalRecipes = await recipeCollection.estimatedDocumentCount();
    const totalReports = await reportCollection.estimatedDocumentCount();
    const totalPremiumMembers = await userCollection.countDocuments({ 
      role: "user", 
      isPremium: true 
    });

    res.status(200).send({
      success: true,
      totalUsers,
      totalRecipes,
      totalPremiumMembers,
      totalReports
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});




app.get('/api/admin/users', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const users = await userCollection.find({ role: "user" }).sort({ createdAt: -1 }).toArray();
    res.status(200).send({ success: true, data: users });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.patch('/api/admin/users/block/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid User ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked: true, updatedAt: new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found or already blocked" });
    }

    res.status(200).send({ success: true, message: "User blocked successfully!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.patch('/api/admin/users/unblock/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid User ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked: false, updatedAt: new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found or already unblocked" });
    }

    res.status(200).send({ success: true, message: "User unblocked successfully!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});



app.get('/api/admin/recipes', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const recipes = await recipeCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.status(200).send({ success: true, data: recipes });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.patch('/api/admin/recipes/feature/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { isFeatured, email } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const result = await recipeCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isFeatured: isFeatured, updatedAt: new Date() } }
    );

    res.status(200).send({ 
      success: true, 
      message: isFeatured ? "Recipe marked as Featured!" : "Recipe removed from Featured!" 
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.delete('/api/admin/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.query;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const result = await recipeCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "Recipe not found" });
    }

    res.status(200).send({ success: true, message: "Recipe deleted successfully by admin!" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.put('/api/admin/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    const { email } = updatedData; 

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    const recipe = await recipeCollection.findOne({ _id: new ObjectId(id) });
    if (!recipe) {
      return res.status(404).send({ success: false, message: "Recipe not found" });
    }

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        recipeName: updatedData.recipeName,
        category: updatedData.category,
        cuisineType: updatedData.cuisineType,
        difficultyLevel: updatedData.difficultyLevel,
        preparationTime: parseInt(updatedData.preparationTime) || 10,
        instructions: updatedData.instructions,
        updatedAt: new Date()
      }
    };

    const result = await recipeCollection.updateOne(filter, updateDoc);
    res.status(200).send({ success: true, message: "Recipe updated successfully by admin!", result });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});




app.get('/api/admin/reports', verifyToken, async (req, res) => {
  try {
    const requesterEmail = req.query.email;
    
       const adminUser = await userCollection.findOne({ email: requesterEmail });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

       const reports = await reportCollection.aggregate([
      {
        $lookup: {
          from: "recipes",
          let: { r_id: "$recipeId" }, 
          pipeline: [
            {
              $match: {
                $expr: {
                  
                  $eq: ["$_id", { $toObjectId: "$$r_id" }] 
                }
              }
            }
          ],
          as: "recipeDetails"
        }
      },
      {
        $unwind: {
          path: "$recipeDetails",
          preserveNullAndEmptyArrays: true 
        }
      },
      { $sort: { createdAt: -1 } }
    ]).toArray();

    res.status(200).send({ success: true, data: reports });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

app.patch('/api/admin/reports/:id', verifyToken, async (req, res) => {
  try {
    const reportId = req.params.id;
    const { action, recipeId, email } = req.body; 
    if (!ObjectId.isValid(reportId)) {
      return res.status(400).send({ success: false, message: "Invalid Report ID" });
    }

    const adminUser = await userCollection.findOne({ email: email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

   
    if (action === 'dismiss') {
      const deleteReport = await reportCollection.deleteOne({ _id: new ObjectId(reportId) });
      
      if (deleteReport.deletedCount === 0) {
        return res.status(404).send({ success: false, message: "Report not found" });
      }
      return res.status(200).send({ success: true, message: "Report dismissed and cleared successfully!" });
    } 
    
        if (action === 'remove') {
      if (recipeId && ObjectId.isValid(recipeId)) {
        await recipeCollection.deleteOne({ _id: new ObjectId(recipeId) });
      }
      
            await reportCollection.deleteOne({ _id: new ObjectId(reportId) });
      
      return res.status(200).send({ success: true, message: "Recipe removed and report cleared successfully!" });
    }

    res.status(400).send({ success: false, message: "Invalid action specified" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.get('/api/payments', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const adminUser = await userCollection.findOne({ email });
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).send({ success: false, message: "Access denied. Admins only." });
    }

    
    const subscriptionPayments = await paymentCollection.find().toArray();
    const recipePurchases = await purchasedRecipesCollection.find().toArray();

       const map = new Map();

    subscriptionPayments.forEach((p) => {
      map.set(p.transactionId, {
        _id: p._id,
        userEmail: p.userEmail,
        amount: p.amount,
        transactionId: p.transactionId,
        paidAt: p.paidAt,
        paymentStatus: p.paymentStatus,
        recipeId: p.recipeId || null,
      });
    });

    recipePurchases.forEach((p) => {
      const txId = p.transactionId || p.stripeSessionId;
      map.set(txId, {
        _id: p._id,
        userEmail: p.userEmail,
        amount: p.amount,
        transactionId: txId,
        paidAt: p.purchasedAt || p.paidAt,
        paymentStatus: p.paymentStatus,
        recipeId: p.recipeId,
      });
    });

    const combined = Array.from(map.values()).sort(
      (a, b) => new Date(b.paidAt) - new Date(a.paidAt)
    );

    res.status(200).send({ success: true, data: combined });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

// // Server-side: index.js
// app.get('/api/recipes', async (req, res) => {
//   try {
//     const { isFeatured } = req.query; 
//     let query = {};
    

//     if (isFeatured === 'true') {
//       query = { isFeatured: true };
//     }

//     const recipes = await recipeCollection.find(query).toArray();
//     res.status(200).send({ success: true, data: recipes });
//   } catch (error) {
//     res.status(500).send({ success: false, message: error.message });
//   }
// });


app.get('/api/my-recipes', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const query = { authorEmail: email };
    const myRecipes = await recipeCollection.find(query).sort({ createdAt: -1 }).toArray();
    
    res.status(200).send({ success: true, data: myRecipes });
  } catch (error) {
    console.error("My Recipes Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});


app.put('/api/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    const authorEmail = updatedData.email; 

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }
    if (!authorEmail) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

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
        status: "pending",
        updatedAt: new Date()
      }
    };

    const result = await recipeCollection.updateOne(filter, updateDoc);
    res.status(200).send({ success: true, message: "Recipe updated successfully!", result });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});


app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { email } = req.query;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }
    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const recipe = await recipeCollection.findOne({ _id: new ObjectId(id) });
    if (!recipe) {
      return res.status(404).send({ success: false, message: "Recipe not found" });
    }
    if (recipe.authorEmail !== email) {
      return res.status(403).send({ success: false, message: "Unauthorized: You can only delete your own recipes" });
    }

    const result = await recipeCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ success: true, message: "Recipe deleted successfully!", result });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

//     console.log("Connected successfully to MongoDB!");
//   } catch (error) {
//     console.dir(error);
//   }
// }
// run().catch(console.dir);

app.listen(port, () => {
  console.log(`RecipeHub app listening on port ${port}`);
});

module.exports = app;