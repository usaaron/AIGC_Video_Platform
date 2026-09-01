# Account-Level Asset Library

Status: accepted

资产库是账号级长期资产集合，项目资产设计仍是项目级内容。用户可以把项目资产和生成结果保存到资产库，也可以从资产库导入当前项目；导入是复用，不是移动。

We rejected mixing the asset library into the project asset editor because users can own multiple projects and need reusable images, scripts, audio, videos and final cuts outside any single project. We also keep `trustedAssets` separate because authorized real-face material has different consent and provider semantics than general reusable assets.
