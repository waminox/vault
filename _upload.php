</div>
<style>
    .custom-select-wrapper {
        position: relative;
        width: 200px;
        margin-bottom: 20px;
        margin: auto;
        margin-bottom: 50px;
    }

    .custom-select-wrapper select {
        width: 100%;
        height: 40px;
        background-color: #fff;
        border: 2px solid #007bff;
        border-radius: 5px;
        padding: 5px 10px;
        appearance: none;
        /* Removes default styling of select dropdown */
        -moz-appearance: none;
        -webkit-appearance: none;
    }

    .custom-select-wrapper::after {
        content: '\25BC';
        position: absolute;
        top: 50%;
        right: 10px;
        transform: translateY(-50%);
        pointer-events: none;
        color: #007bff;
    }

    .file-input-wrapper {
        position: relative;
        width: 200px;
        margin: auto;
    }

    input[type="file"] {
        width: 0.1px;
        height: 0.1px;
        opacity: 0;
        overflow: hidden;
        position: absolute;
        z-index: -1;
    }

    label#fileLabel {
        position: relative;
        display: inline-block;
        background-color: #007bff;
        color: #fff;
        padding: 10px 20px;
        border-radius: 5px;
        cursor: pointer;
        width: 200px;
        text-align: center;
    }

    label#fileLabel:hover {
        background-color: #0056b3;
    }
    
    #upfo{
        box-shadow: 0 10px 16px 0 rgba(0,0,0,0.2), 0 6px 20px 0 rgba(0,0,0,0.19) !important;
        max-width: 520px;
        margin: auto;
        margin-top: 20px;
        padding: 80px;
        border-radius: 20px;
    }
    .upstate{
        word-wrap: break-word; /* Deprecated but still used for wide browser compatibility */
        overflow-wrap: break-word; /* Recommended, as it's the standard property */
        white-space: pre-wrap; 
    }
</style>
<div id="upfo">
    <div class="custom-select-wrapper">
        <?php
        // Path to the current directory
        $dir = ".";

        // Get array of all directory names in the current directory
        $folders = array_filter(glob('*'), 'is_dir');

        // Remove unwanted directories from the list
        $exclude = array('src', 'trash'); // Add any other directories you want to exclude
        $folders = array_diff($folders, $exclude);

        // Start building the select element
        echo '<select name="folderSelect", id="folderSelect">';

        // Loop through the folders and create an option element for each
        foreach ($folders as $folder) {
            echo "<option value=\"/$folder/\">$folder</option>";
        }

        // Close the select element
        echo '</select>';
        ?>
    </div>
    <div class="file-input-wrapper">
        <input type="file" multiple="" id="file" onchange="upf()" onclick="e.preventDefault();">
        <label for="file" id="fileLabel">Choose files</label>
    </div>
    <div class="upstacon">
        <h5 class="upstate" id="status"></h5>
    </div>
</div>
<script src="upload_script.js"></script>
<div>