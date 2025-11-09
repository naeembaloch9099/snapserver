# Debug Tools

## Check Orphaned Posts

This script helps diagnose post ownership issues and find orphaned posts.

### Usage

```bash
cd Server
node scripts/check-orphaned-posts.js <username>
```

### Example

```bash
node scripts/check-orphaned-posts.js zidi_baloxh
```

### What it checks

1. **Posts by ObjectId** - Correct way (owner field is ObjectId reference)
2. **Posts by username string** - Wrong way (indicates schema mismatch)
3. **All posts sample** - Shows owner field format for debugging
4. **User's comments** - Shows comment activity

### Expected Output

For a new user with no posts:

✅ No posts found - this is normal for a new user

```

For a user with posts:

```

✅ Found 3 posts correctly linked

```

If orphaned posts exist:

```

⚠️ ACTION REQUIRED: Orphaned posts found with string owner!
Run migration to convert string owners to ObjectIds

```

## Browser Console Debug

When viewing a profile, check the browser console for:

### PostContext logs:

- `📥 [PostContext.loadFeed] Server response summary` - Shows total posts loaded
- Owner format breakdown for each post

### Profile logs:

- `🔍 [Profile userPosts] Filtering posts` - Shows how posts are matched
- `✅ Post X owner "..." MATCHES "..."` - Successful matches
- `❌ Post X owner "..." doesn't match "..."` - Failed matches
- `📊 Filtered result: X posts for user "..."` - Final count

### What to look for:

1. **Total posts in context** vs **Filtered result** - Should match for user's own posts
2. **Owner format** - Should be username string (most reliable)
3. **ownerUsername field** - Should match current user's username
4. **Match methods** - Shows which method successfully matched (1-4)
```
