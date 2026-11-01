<html>

<head>

  <link rel="stylesheet" href="style.css">

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/1.6.14/css/lightgallery.css">

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.1/css/all.min.css">

  <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" integrity="sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z" crossorigin="anonymous">

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/2.1.3/jquery.min.js"></script>

  <script src="https://cdn.jsdelivr.net/picturefill/2.3.1/picturefill.min.js"></script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-mousewheel/3.1.13/jquery.mousewheel.min.js"></script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/1.6.14/js/lightgallery-all.min.js"></script>

  <script src="https://cdn.jsdelivr.net/npm/lg-video@1.4.0/dist/lg-video.min.js"></script>
  <script src="loading.js"></script>

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">

  <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, minimum-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex">

</head>

<body>
<?php require_once("functions.php"); ?>
  <nav class="navbar navbar-expand-lg navbar-light bg-light">

    <a class="navbar-brand" href="#"><img src="95148af5-4c41-41c2-a7a0-96ecf5f3f554.png" style="width: 100px;"/></a>

    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarSupportedContent" aria-controls="navbarSupportedContent" aria-expanded="false" aria-label="Toggle navigation">

      <span class="navbar-toggler-icon"></span>

    </button>



    <div class="collapse navbar-collapse" id="navbarSupportedContent">

      <ul class="navbar-nav mr-auto">

      <?php createMenu(); ?>

        <li class="nav-item">

          <a class="nav-link" href="/vault?type=upload" id="navbarDropdown" role="button">

          <i class="fas fa-upload"></i> Upload

          </a>

        </li>

        <li class="nav-item">

          <a class="nav-link newCache" href="#" id="navbarDropdown" role="button">

          <i class="fas fa-refresh"></i> New Cache

          </a>

        </li>

        <li class="nav-item" id="toggleBlur">

          <a class="nav-link" href="#" id="navbarDropdown" role="button">

          _<i class="fas fa-eye" ></i>_

          </a>

        </li>

        <li class="nav-item">

          <a class="nav-link logoutbtn" href="#" id="navbarDropdown" role="button" onClick="document.getElementById('logoutform').submit();">

            <i class="fa-solid fa-lock"></i> Logout

          </a>

        </li>

      </ul>

    </div>

  </nav>